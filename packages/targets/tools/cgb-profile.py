"""Reusable ROM/listing-aware measurements; no game behavior is encoded here.

Hooks observe release instructions, including interrupts during calls. This is
an emulator protocol, not a claim about physical PPU/CPU timings or audio.
"""
from pathlib import Path
import hashlib, io, json, math, re

def sha(data):
    return hashlib.sha256(data).hexdigest()

def distribution(values):
    if not values:
        return {"count": 0}
    v = sorted(values)
    # Nearest-rank percentiles, explicitly consistent for small samples.
    rank = lambda q: v[max(0, math.ceil(len(v) * q) - 1)]
    return {"count": len(v), "sum": sum(v), "min": v[0],
            "median": (v[(len(v)-1)//2] + v[len(v)//2])/2,
            "p95": rank(.95), "max": v[-1]}

class RomSymbols:
    def __init__(self, rom, noi, objects):
        self.rom = Path(rom).read_bytes()
        self.noi = Path(noi).read_bytes()
        self.objects = Path(objects)
        self.symbols = {m[1]: int(m[2], 16) for m in
                        re.finditer(r"DEF (\S+) 0x([\da-fA-F]+)", self.noi.decode())}
        self.modules, self.sources = {}, {}

    def module(self, name, anchor):
        if name not in self.modules:
            obj = (self.objects/(name+".o")).read_bytes()
            listing = (self.objects/(name+".lst")).read_bytes()
            self.sources[name] = {"objectSha256": sha(obj), "listingSha256": sha(listing)}
            area, target = None, None
            for line in obj.decode().splitlines():
                if line.startswith("A "): area = line.split()[1]
                if line.startswith("S "+anchor+" Def"): target = area; break
            if target is None: raise ValueError("missing anchor area "+anchor)
            area, lines = None, []
            for line in listing.decode().splitlines():
                match = re.search(r"\.area (\S+)", line)
                if match: area = match[1]
                if area == target: lines.append(line)
            labels = {m[2]: int(m[1], 16) for line in lines
                      if (m := re.match(r"\s+([\da-fA-F]{8})\s+\d+ (_\w+):", line))}
            full = self.symbols[anchor]
            self.modules[name] = (lines, labels, full >> 16, (full & 65535)-labels[anchor])
        return self.modules[name]

    def pointer(self, name, anchor, symbol):
        lines, _, bank, base = self.module(name, anchor)
        for line in lines:
            ins = re.match(r"\s+([\da-fA-F]{8})\s+(FA|EA|21|11|01)(?:r[\da-fA-F]{2}){2}", line)
            operand = re.search(r"#"+re.escape(symbol)+r"\b(?:\s*([+-])\s*(0x[\da-fA-F]+|\d+))?", line)
            if ins and operand:
                at = bank*16384+base+int(ins[1],16)-(16384 if bank else 0)+1
                add = int(operand[2],0) if operand[2] else 0
                return int.from_bytes(self.rom[at:at+2],"little")-(-add if operand[1]=="-" else add)
        raise ValueError("missing data operand "+symbol)

    def function(self, name, anchor, symbol):
        lines, labels, bank, base = self.module(name, anchor)
        start = labels[symbol]
        end = min((v for v in labels.values() if v > start), default=65536)
        returns = [base+int(m[1],16) for line in lines
                   if (m := re.match(r"\s+([\da-fA-F]{8})\s+C9\s+.*\bret\s*$",line))
                   and start <= int(m[1],16) < end]
        return bank, base+start, returns

class StageTimers:
    def __init__(self, pyboy, symbols, context):
        self.pb, self.symbols, self.context = pyboy, symbols, context
        self.active, self.samples, self.entries, self.hooks = {}, [], {}, []

    def attach(self, module, anchor, symbol, detail=None, completed=None):
        bank, entry, returns = self.symbols.function(module, anchor, symbol)
        def enter(_):
            c = dict(self.context())
            if detail: c.update(detail())
            if returns:self.active.setdefault(symbol,[]).append((self.pb._cycles(),c))
            key = c["phase"]+":"+symbol
            self.entries[key] = self.entries.get(key,0)+1
        def leave(_):
            stack = self.active.get(symbol)
            if not stack: return
            start, c = stack.pop()
            sample={**c,"stage":symbol,"tCycles":self.pb._cycles()-start}
            if completed: sample.update(completed(c))
            self.samples.append(sample)
        self.pb.hook_register(bank,entry,enter,None)
        for at in returns: self.pb.hook_register(bank,at,leave,None)
        self.hooks.append({"module":module,"stage":symbol,"bank":bank,"entry":entry,"returns":returns,"measurement":"inclusive-call" if returns else "entry-count-only (tail transfer)"})

    def report(self):
        groups = {}
        for s in self.samples: groups.setdefault(s["phase"]+":"+s["stage"],[]).append(s["tCycles"])
        return {"unit":"emulated SM83 T-cycles, inclusive of interrupts",
                "quantile":"nearest-rank p95; arithmetic median",
                "entries":self.entries,"statistics":{k:distribution(v) for k,v in groups.items()},
                "samples":self.samples,"hooks":self.hooks,
                "unfinishedCalls":{k:len(v) for k,v in self.active.items() if v}}

def guarded_entropy_hook(pb, symbols, entropy=0):
    """Override only the already loaded cru_stir entropy argument.
    Guard the actual SDCC instruction sequence; keep original instructions,
    stack, cycles and RNG updates. This mode is explicit in each receipt.
    """
    if not isinstance(entropy,int) or not 0<=entropy<=255:raise ValueError('invalid entropy byte')
    full = symbols.symbols["_cru_stir"]
    bank, at = full >> 16, full & 65535
    offset = bank*16384+at-(16384 if bank else 0)
    code = symbols.rom[offset:offset+40]
    match = re.search(b"\xf8\x0a\x7e\xd1\xd5\x6f", code)
    if code[:2] != b"\x3b\x3b" or not match:
        raise ValueError("unrecognized cru_stir ABI; no entropy hook installed")
    hook = at+match.start()+3
    def replace(_): pb.register_file.A = entropy
    pb.hook_register(bank,hook,replace,None)
    return {"mode":"controlled-cru_stir-argument","entropy":entropy,"bank":bank,
            "hook":hook,"guardSha256":sha(code),"normalGameEntropyUnchanged":True}

def guarded_div_read(pb,symbols,module,anchor,function,entropy=0):
    """Control an explicit DIV-derived argument at its source read site."""
    lines,labels,bank,base=symbols.module(module,anchor)
    start=labels[function];end=min((v for v in labels.values() if v>start),default=65536)
    reads=[]
    for line in lines:
        m=re.match(r'\s+([\da-fA-F]{8})\s+F0r[\da-fA-F]{2}.*ldh.*_DIV_REG',line)
        if m and start<=int(m[1],16)<end:
            at=base+int(m[1],16);off=bank*16384+at-(16384 if bank else 0)
            if symbols.rom[off:off+2]!=b'\xf0\x04':raise ValueError('DIV read ROM/listing mismatch')
            def replace(_):pb.register_file.A=entropy
            pb.hook_register(bank,at+2,replace,None);reads.append(at+2)
    if len(reads)!=1:raise ValueError('expected one DIV argument site in '+function)
    return {'mode':'controlled-DIV-argument-read','function':function,'bank':bank,'hooks':reads,'entropy':entropy}

def read_cram(pb, obj=False):
    """Read palette RAM from pinned PyBoy state v15 without any IO writes.

    Layout: motherboard header 5 + CGB HDMA 10 + CPU 26; LCD VRAM0
    8192, OAM 160, registers 11, scanline params 720, timing fields 30,
    VRAM1 8192, VBK 1, then BG index 4 / colors 64 / OBJ index 4 / colors
    64. Guard the version, CGB flags and register offsets on every read.
    """
    out=io.BytesIO();pb.save_state(out);data=out.getvalue()
    if len(data)<17483 or data[0]!=15 or data[4]!=1 or data[9124]!=1:
        raise ValueError('unsupported PyBoy CGB serialized-state layout')
    if data[8393]!=pb.memory[0xff40] or data[8397]!=pb.memory[0xff41]:
        raise ValueError('PyBoy LCD register state offsets changed')
    return data[17419:17483] if obj else data[17351:17415]

class PaletteUploads:
    """Observe intended runtime bytes, actual SDK IO writes, mode and CRAM.
    Refuse unknown SDK instruction layouts rather than guess at IO timing.
    """
    def __init__(self, pb, symbols, context):
        self.pb,self.context,self.active,self.records=pb,context,{},[]
        full=symbols.symbols['_set_bkg_palette']
        bank,base=full>>16,full&65535
        offset=bank*16384+base-(16384 if bank else 0)
        code=symbols.rom[offset:offset+34]
        if code[:3]!=b'\xc5\x0e\x68' or code[-2:]!=b'\xc1\xc9':
            raise ValueError('unrecognized GBDK palette ABI')
        match=code.find(b'\x2a\xe2\x05\x20\xf5')
        if match<0: raise ValueError('unrecognized GBDK palette write loop')
        def begin(obj):
            def enter(_):
                sp=pb.register_file.SP; first=pb.memory[sp+2]; count=pb.memory[sp+3]
                ptr=pb.memory[sp+4]|pb.memory[sp+5]<<8
                expected=bytes(pb.memory[ptr+i] for i in range(count*8))
                self.active={'obj':obj,'first':first,'count':count,'buffer':ptr,
                             'expected':expected,'writes':[],**context()}
            return enter
        def write(_):
            r=self.active
            if not r: raise ValueError('palette write outside captured call')
            port=pb.register_file.C
            if port!=(0x6b if r['obj'] else 0x69):raise ValueError('wrong palette port')
            r['writes'].append({'tCycle':pb._cycles(),'mode':pb.memory[0xff41]&3,
                                'lcdOn':bool(pb.memory[0xff40]&128),'byte':pb.register_file.A})
        def done(_):
            r=self.active
            if not r:return
            start=r['first']*8;actual=read_cram(pb,r['obj'])[start:start+len(r['expected'])]
            writes=bytes(w['byte'] for w in r['writes'])
            self.records.append({**{k:v for k,v in r.items() if k not in ['expected','writes']},
                'expectedHex':r['expected'].hex(),'actualCramHex':actual.hex(),
                'writeCount':len(writes),'writeBytesAgree':writes==r['expected'],
                'cramBytesAgree':actual==r['expected'],
                'mode3Writes':sum(w['lcdOn'] and w['mode']==3 for w in r['writes']),
                'writeModes':{str(m):sum(w['mode']==m for w in r['writes']) for m in range(4)},
                'firstCycle':r['writes'][0]['tCycle'] if r['writes'] else None,
                'lastCycle':r['writes'][-1]['tCycle'] if r['writes'] else None})
            self.active={}
        sprite=symbols.symbols['_set_sprite_palette']
        pb.hook_register(bank,base,begin(False),None)
        pb.hook_register(sprite>>16,sprite&65535,begin(True),None)
        pb.hook_register(bank,base+match+1,write,None)
        pb.hook_register(bank,base+len(code)-1,done,None)
        self.guard={'sdkPaletteCodeSha256':sha(code),'entry':base,'write':base+match+1,'return':base+len(code)-1}
