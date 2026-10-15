# CWL2: Chromatic Wi-Fi Link, version 2

Goal: unmodified GB/GBC games use the normal link port (`FF01` SB, `FF02` SC) and
play over Wi-Fi. The peer is another Chromatic or a desktop emulator speaking the
same packets (`tools/cwl_peer`). Both run the same protocol core
(`mcu/components/cwl/cwl_proto.c`).

## Model: the slave decides

A link-cable transfer swaps the master's SB with the slave's SB. Over a network
the master cannot clock bits it does not have, so:

1. **Master starts.** The master game writes SC = `0x81`. Its side **holds the
   transfer** (SC bit 7 stays set, no IRQ) and sends `REQ(seq, master_byte)`.
2. **Slave decides.** The peer offers the byte to its link port. If the port is
   armed (SC = `0x80`) the exchange happens there and then: the slave game gets
   `master_byte` and an IRQ, and the side replies `ACK(seq, slave_byte)` with the
   byte its port actually shifted out. If the port is not armed, the request
   waits and is offered again the moment the game arms.
3. **Master completes** on `ACK`: SB = `slave_byte`, IRQ.

The slave's port is the only authority on whether an exchange happened, so the
two games can never disagree, even when a game arms and then withdraws to become
master itself (Tetris DX does this every byte).

**Timeout.** After `master_timeout_ms` (default 250 in the core, 1500 on the
Chromatic: a modem-sleeping slave needs up to ~300 ms) the master sends `CANCEL`.
The slave answers `ACK` if the exchange already happened (the master takes it) or
`CANCELLED` (the master completes with `0xFF`, what real hardware reads with no
partner). With no live peer the master completes with `0xFF` at once
(cable unplugged).

**Restarted transfers.** A game may write SC = `0x81` again while its master
transfer is still held (Tetris DX does it every frame until the first byte of a
packet completes; on hardware that byte took 1 ms, so the rewrite never overlapped).
That rewrite continues the held transfer: the FPGA emits no second `MASTER`
event, and the core ignores `MASTER` while a request is in flight. Starting a new
request instead made the slave exchange twice and desynced Tetris DX right after
the 2PLAYER handshake.

**Write barrier.** A game that writes SB or SC while its master is held (other
than the restart above) expects that transfer to be over: on hardware it took
1 ms. The port parks the write and stalls the CPU (as a GDMA does), and the side
asks the peer at once (`CANCEL`, `Cwl_OnLocalMasterAbandon`): `ACK` completes the
master with the peer's byte and its IRQ, `CANCELLED` releases it silently (no
IRQ, SB untouched; `MASTER_DROP`); then the parked write lands and the CPU runs
on. One round trip of stall. Dropping the transfer at the write instead let the
peer exchange a byte this side never received (Super Mario Bros. Deluxe VS), and
completing it with `0xFF` raised the IRQ after the game's own SB write (Pokemon
Gold/Silver read its own `0x02` as the partner's, both sides became master).
**Stop then restart.** `SC = 0x01` (stop, internal clock) under a held master is
absorbed (FPGA 18.19, cwl_peer `--fpga`): no stall, no event, the transfer stays
held, and the `0x81` that normally follows continues it. On hardware that byte
finished 1 ms after it started, so the game is only stopping a finished transfer
to start the next (Pokemon Gold/Silver `LinkTransfer` / `Serial_ExchangeByte` write
`0x01, 0x81` every frame). Treating it as a barrier write stalled the master a
Wi-Fi round trip whenever a byte was still in flight at the next frame; under real
Wi-Fi jitter and loss the master game fell frames behind the slave, and Gen 2's
frame-timed handshakes (each byte sent for 10 frames) slid out of step: after the
save the slave entered the trade room while the master waited at "Please wait"
forever (on hardware with the Chromatic as master, and in Mac pairs with
`--jitter-ms 15 --loss-pct 5`: 4/4 stuck, 0/4 with the absorb). Writes that change
the clock source (`0x00`, `0x80`) or SB still park and stall.

An `ABANDON` for a master the side never heard of (its `MASTER` event was lost
on the UART), while no reply is on its way to the port (none sent in the last
10 ms), is answered with `MASTER_DROP` at once: no request went out, so nobody
exchanged. Ignoring it left the CPU stalled until the FPGA's ~4 s safety timeout,
which completed the master with `0xFF` and an IRQ after the parked write had
landed (see the event queue below).

**Fast clock.** A master started on the CGB fast clock (SC bit 1, 8 bits in
~30 us on hardware) stalls the CPU until the reply: games using it wait only a
short delay loop (SMB Deluxe sends `FE`, waits ~1.7 ms, and clears the reply a
frame later). Normal-clock masters keep the CPU running while held (Tetris DX,
Pokemon poll for the IRQ). If both sides hold stalled masters, neither can ever
arm: a refused offer reports the collision and both masters complete with `0xFF`
after one round trip (what two masters clocking at once read on hardware)
instead of freezing for the master timeout.

**Standing offers** (FPGA 18.20 + ESP32 0.13.14, CONFIG bit 3; cwl_peer `--fpga`).
An offer the port cannot take (not armed) stays at the port and is exchanged in
the very cycle the game arms (`SLAVE_DONE` instead of `ARMED`), until the side
withdraws it (cmd 6 `SLAVE_WITHDRAW`: `SLAVE_NAK` if it still waited, nothing if it
was exchanged, its `SLAVE_DONE` being the answer). The side withdraws on the
peer's `CANCEL` (then answers `CANCELLED` or `ACK` by the port's verdict), on a
newer request, on a peer restart and when the peer goes away. Pokemon Gold/Silver
search for a partner by arming for ~20 us per frame and becoming master again;
an offer that has to cross the UART after an `ARMED` never finds them armed, so two
sides that start searching together never connected (they only met when one side
entered the search, which first arms for 3 frames, while the other was already in
it). With standing offers the next brief arm takes the peer's request. A standing
offer while the port holds a fast-clock master with the CPU stalled reports
event 7 once (collision) and keeps standing. Older FPGA builds ignore bit 3 and
answer offers at once; the core then behaves as before.

**Offers without ARMED.** `ARMED` is only a hint. A pending peer request is also
offered to the port every 20 ms without it (the port answers `SLAVE_NAK` if not
armed), so a port that armed before the link came up, or an `ARMED` lost on the
UART, cannot stall the peer. An offer the port never answers counts as refused
after 500 ms.

CWL1 (the master consumed an advisory ARM) desynced Tetris DX: an ARM could be
consumed after the slave had withdrawn it.

## UDP packets (port 47820)

All packets: `'C' 'W' 0x02 type seq byte` (6 bytes).

| type | name      | direction | meaning |
|------|-----------|-----------|---------|
| 1 | REQ       | master -> slave | exchange `byte` (master's SB); `seq` = master's counter |
| 2 | ACK       | slave -> master | exchanged; `byte` = slave's SB |
| 3 | CANCEL    | master -> slave | master wants to give up on `seq` |
| 4 | CANCELLED | slave -> master | `seq` was NOT exchanged |
| 5 | HELLO     | both | keepalive / discovery, every 500 ms; `seq`,`byte` = 16-bit session id (random per start, 0 = none) |
| 6 | HELLO_PROBE | both | a HELLO that asks for an immediate HELLO back; sent every 100 ms by a side whose radio just woke, until it hears the peer |
| 7-12 | send-ahead | | CAPS, PUSH, TAKE, REVOKE, REVOKED, WANT: only between two sides that both speak it (see Send-ahead) |

Reliability: `REQ` and `CANCEL` are re-sent every 20 ms until answered. The
slave remembers its last `ACK` and `CANCELLED` and repeats them for duplicate
requests; requests older than the newest seen are ignored. A request newer than any seen drops the remembered `ACK` / `CANCELLED` (the master has finished every older seq): after the 8-bit seq wraps, a `CANCELLED` remembered from 256 requests earlier must not answer a new request with the same number. A HELLO with a new
session id means the peer restarted: the slave forgets the peer's sequence
numbers (otherwise its new requests would be ignored as old, or answered with a
stale `ACK`). A peer request still waiting for an unarmed port is dropped once
the peer has not been heard for 2 s (its master gave up long ago); a resend of
it is then ignored as old, and its `CANCEL` gets `CANCELLED`.

## Power (ESP32)

Wi-Fi runs flat out only while the link is in use. "In use" = a link-port event
from the FPGA (ARMED, DISARM, MASTER, SLAVE_DONE; not SLAVE_NAK, which only
answers our own offer probe) or an exchange packet from the peer (REQ, ACK,
CANCEL, CANCELLED; not HELLO) in the last `active` seconds.

| level   | when | Wi-Fi | MCU |
|---------|------|-------|-----|
| full    | in use and the partner answers (or a wake is waiting for it, or the first 10 s of joining) | on, no power save | awake |
| low     | in use with no partner (a game polling the port), or within `standby` s of the last use, or the port armed as slave within `armed` s | on, modem sleep (listen interval 3 beacons, ~300 ms) | awake |
| dormant | otherwise | **off** | light sleep as stock firmware (100 ms after the last FPGA packet) |
| off     | the OSD switch (SYSTEM > WI-FI LINK) is off | off | stock |

Defaults `active` 20 s, `standby` 60 s, `armed` 300 s (`cwl power`). The radio
is never powered down while an exchange is in progress.

**Waking.** While dormant the ESP32 sends `CONFIG` with bit 1 set, and the FPGA
puts the stock wake preamble (20 x `0x00`, ~1.7 ms) in front of each link event,
so the first event wakes the MCU from light sleep and still arrives intact. The
ESP32 then starts Wi-Fi (known channel, the last DHCP address reused for up to an
hour, gratuitous ARPs) and **holds** a `MASTER` for the peer for up to
`3600 - master_timeout` ms (2 s with the 1500 ms default) instead of reading
`0xFF` at once; meanwhile it sends `HELLO_PROBE`s. Measured on hardware: the event
is processed 7 ms after the FPGA sent it, Wi-Fi associated with an address after
80-110 ms, the partner (a Mac) answered after 0.6-0.9 s (the Mac's own ARP
recovery), and the held first byte completed with the partner's byte.

A dormant side cannot hear its partner: a game that waits armed as slave for
longer than `armed` s, with no other link activity, needs its own side to use the
port again (or a re-arm) before a partner's request gets through.

## Internet: the Shiny Link relay (ESP 0.14+)

The same 6-byte CWL2 packets can travel over the internet, wrapped in the Shiny
Link envelope v1 (spec: shiny_gen_3 `notes/CHROMATIC_RELAY.md` section 2; C port
`mcu/components/cwl/cwl_relay.c`, byte-identical to `link_wire.rs`, golden bytes
pinned in `tools/relay/cwl_relay_test.c`). `cwl_proto.c` is unchanged: the
transport only decides where a packet goes.

* **Pairing** (OSD SYSTEM > ONLINE, or `cwl relay pair`): `POST
  api.shinyrelay.com/device_link/start {"scope":"link"}` gives an `ABCD-EFGH` code;
  the OSD shows it (A: a QR of `https://shinygen.ai/link?code=...`), the owner
  approves it signed in at shinygen.ai/link, the device's poll then returns a
  link-device token (1 year; never a session). Stored in NVS namespace `cwlrel`
  (plain NVS: no flash encryption on this unit, and NVS encryption needs it or an
  HMAC eFuse key the original ESP32 lacks); never printed. Unpair = A A on
  UNPAIR (`POST /link_device/revoke`), or a password reset on the account.
* **Tickets**: `POST /link_device/ticket` (bearer = the device token) gives a
  single-use 2-minute relay ticket, the relay address and the room instruction
  (`mine` by default: the account's other device, no code). One spare ticket is
  kept while the radio is up, so a JOIN never waits for HTTPS. A full TLS
  handshake to api.shinyrelay.com takes ~4-5 s on this ESP32 (Let's Encrypt Gen
  Y chain: three P-384 ECDSA verifications; TLS resumption is not usable with
  the dynamic mbedTLS buffers the heap needs, see the mcu commit).
* **Seat**: JOIN on the 47820 socket (`'SL'` envelopes and bare `'CW'` packets
  share it), re-sent every 250 ms with one nonce; WELCOME gives a token, PEER
  the partner's public + LAN endpoints. Both sides punch (50 ms, 5 s); the first
  answer becomes the direct path (the LAN candidate is preferred over a router
  hairpin), DATA goes direct with the room's p2p key, the relay is the fallback
  after 3 s of direct silence. `cwl relay force on` (a hidden console option
  since 0.17.0; before it the OSD's FORCE RELAY) never punches. The relay forgets a seat after 10 min of silence; `unknown_session`
  -> a new ticket and JOIN with the same client id (= device id), which takes
  the seat back.
* **Transport**: the LINK CABLE mode (see Link modes). 0.14-0.16 had a separate
  ONLINE "via" setting (`cwl relay mode auto|lan|relay`); 0.17.0 retired it (the
  console command now says so): a stored `lan` becomes mode NEARBY and `relay`
  becomes ONLINE once, at boot, when the mode was AUTO.
* **Room** (`cwl relay room`, OSD ROOM/CODE): `app` (what the Shiny Gen app set,
  default mine), `mine`, `host` (the code is shown and reported to the app),
  `join <code>` (6 of `BCDFGHJKMNPQRSTVWXZ23456789`).
* **Power**: nothing is sent while dormant (Wi-Fi off). On radio-up the old token
  pings the relay at once (the relay rebinds the new address and re-brokers).
  Relay PING every 2 s at full power, 22 s in modem sleep. **Seat keeper**: while
  dormant, for an hour after the last link use, a timer wake (`CWL_SleepTimerMs`
  -> pwrmgr) brings the radio up every 8 min for one relay PING (the seat and the
  NAT mapping stay), so a wake never needs a ticket. BYE when the link is
  switched off.

Measured 2026-10-09 (Chromatic on the home Wi-Fi, Mac on the same LAN,
prod relay relay.shinyrelay.com, linktest, 60 s runs, 0 errors in every run):

| path | Chromatic master | Chromatic slave | per byte |
|---|---|---|---|
| LAN (`mode lan`, regression) | 31 B/s | ~37 B/s | ~30 ms |
| relay-brokered P2P (direct LAN path) | 40-45 B/s | - | ~22-25 ms |
| relay only (`force on`), RTT to relay 27 ms (Chromatic) + 30 ms (Mac) | 17 B/s | 17 B/s | ~59 ms |

Pokemon Silver (Chromatic) <-> Gold (Mac) Cable Club trade completed through the
relay (force relay). HTTPS calls: 4-7 s each (full handshake), all off the
critical path.

## Link modes (ESP 0.15+)

OSD SYSTEM > LINK CABLE (was WI-FI LINK), console `cwl mode`, NVS `cwl/mode`
(builds before 0.15 had only `enabled`: on maps to AUTO, off to OFF; a device that
never set anything starts in AUTO).

| mode | ESP-NOW | LAN UDP 47820 | relay | needs a router |
|------|---------|---------------|-------|----------------|
| AUTO   | yes | yes | yes (paired, room set) | no (ESP-NOW works without one) |
| NEARBY | yes | yes | no  | no |
| ONLINE | no  | no  | yes | yes |
| OFF    | physical link port | | | |

The mode alone picks the paths (0.17.0 retired the ONLINE menu's VIA setting).
All of it runs on the one Wi-Fi radio at the same time; nothing cycles.

**Paths.** A partner is heard on a path: ESP-NOW, LAN or relay. The first path that
hears a partner wins and keeps the link while it stays fresh (a CWL2 packet within 3 s);
if several are fresh when the choice is made, nearby wins (ESP-NOW, then LAN, then the
relay). A better path to the SAME partner (same HELLO session id) takes over at once
(two Chromatics on one AP hear each other on LAN and ESP-NOW: ESP-NOW is used). Packets
from the other paths are not fed to the protocol core (`path_filtered`). With no path,
only HELLO / HELLO_PROBE go out, on every path the mode allows: an exchange can never
reach two different partners. This extends the 0.14 rule (a LAN peer heard in 3 s beats
the relay). The core (`cwl_proto.c`) and the session code never see which path carried
a packet, so a game could later pick the mode through the network window.

## Local-radio frames (cwl_lx, ESP-NOW now, BLE later)

`mcu/components/cwl/cwl_lx.c` (portable, host-tested by `tools/cwl_lx_test.c`). One
ESP-NOW frame (and, parked, one GATT write / notification) carries one FRAME: units back
to back, each either

* a CWL2 packet, the same 6 bytes as on UDP (`'C' 'W' 0x02 type seq byte`), or
* a control unit `'L' kind len payload[len]`, never given to the core:
  `1` PING (id u8, t_ms u32 LE), `2` PONG (the PING payload echoed), `3` NAME
  (1..15 bytes, A-Z 0-9 space -). Unknown kinds are skipped.

A frame with a malformed unit is dropped whole. The ESP32 sends at most 48 bytes per
frame: everything one link-task pass produced (usually one packet; a resend plus a HELLO
at most) goes out as one frame at the end of the pass.

## Nearby (ESP-NOW)

ESP-NOW frames are 802.11 action frames on the Wi-Fi radio: no AP, no IP, ~1 ms per
hop, MAC-acknowledged with hardware retries when unicast, unacknowledged when
broadcast. It coexists with the station connection (same radio, same channel) and costs
~2 KB of heap (measured on the device, below).

**Discovery and lock.** Unlocked, a side broadcasts: its CWL2 HELLOs (every 500 ms;
HELLO_PROBEs every 100 ms after a wake) are the beacons, plus a NAME unit every second
(every 5 s once paired; always broadcast, so every side nearby can list it). It locks
onto the first side whose CWL2 frame it hears and from then on unicasts to it. The lock
is CONFIRMED when that side unicasts back, i.e. it locked onto us too. A lock not
confirmed within 2 s is dropped and that side snubbed for 10 s (it is busy with someone
else, or a stray beacon); an unconfirmed lock also yields at once to any side that
unicasts to us. Without the confirm rule a stray beacon heard first captured a side for
good (host test "espnow vanish 6 s +f": stuck before, rejoined after). A partner silent
5 s is forgotten (back to broadcast).

**Pairing.** The first confirmed lock with no remembered partner pairs: the partner's
MAC goes to NVS (`cwl/enpeer`), the lock becomes fixed (only that side is accepted from
then on, never forgotten), and the OSD shows `LINKED  <name>` for 3 s. Two devices that
both wait at the same time therefore pair by themselves. SYSTEM > LINK CABLE > A >
PARTNER is the pick list: ANY (forget: pair with the next side that answers), the
remembered partner, and every side heard in the last 10 s, by name, strongest first.
Console: `cwl nearby`, `cwl partner [forget|<mac>]`, `cwl name <text>`. Names default
to `CHROMATIC` + the last two MAC bytes (the station MAC is the ESP-NOW address).

**Channel.** ESP-NOW only reaches a side on the same channel.

* Joined to an AP: the radio is on the AP's channel and stays there. Two Chromatics on
  the same AP meet at once (and also see each other on LAN; ESP-NOW wins for the same
  session).
* No AP (none set, `cwl espnow apjoin off`, or the AP failed 3 joins in a row): the
  side stays on its HOME channel (the last AP's channel if it ever joined one, else
  `cwl espnow channel`, default 1) and, while no partner is heard, visits every other
  channel (1, 6, 11, then the rest) for 120 ms every 2 s, sending a HELLO_PROBE and its
  name on arrival; any side there answers the probe at once. A partner heard pins the
  channel.
* So: both without an AP meet on the shared home channel (both default 1, or both last
  joined the same home AP); one with an AP and one without meet when the sweeping one
  visits the AP's channel (within one sweep, ~3.4 s); two on different APs on different
  channels cannot meet over ESP-NOW (use the relay, or NEARBY on one of them without
  its AP).
* While a nearby partner is fresh the AP is not re-tried (a join scan leaves the channel
  for ~2 s); a failing AP is retried every 30 s instead of the usual backoff.

**Power.** Same levels as Wi-Fi. With an AP, full = no power save, low = modem sleep
(DTIM, listen interval 3). Without an AP, low = connectionless modem sleep (awake 50 ms
of every 100). Dormant = Wi-Fi off (ESP-NOW off); the first link event wakes it as
before and the held master meets the partner's answer. A sleeping side misses frames;
the partner's 20 ms resends land in its awake windows.

**Measure.** `cwl espnow ping [n]`: transport PING/PONG round trip (no game);
`cwl xrtt [reset]`: REQ to ACK/CANCELLED of the game's own exchanges, on any path;
CWS? `mode= path= en=on/channel/peer/confirmed+fixed xrtt=p50/p90/max/n ping= heap=`.

**Measured (host, 2026-10-10).** `tools/cwl_lx_test` 95 checks pass (framing, lock,
snub, pick list, SLIP, two cores over simulated ESP-NOW with a stray beacon and a
vanishing partner, up to 50 % unicast loss). `tools/espnow_shim/e2e_sim.sh` (two shims
+ two `cwl_peer --fpga --hop-ms 3` linktests, 3600 frames, stray beacon on): clean 49 B/s
exchange RTT p50 11 ms; 30 % broadcast / 20 % unicast loss + 3 ms jitter 40 B/s p50 15;
50 % / 50 % + 5 ms 35 B/s p50 19; 0 errors, 0 no-peer, 192 stray frames ignored in each.
On the Chromatic (no partner yet): ESP-NOW up beside the AP association, heap -1.8 KB.

**Mac far end.** `tools/espnow_bridge` (ESP32 dev board firmware: ESP-NOW <-> USB serial,
SLIP of `[type][body][crc8]`, `kBr_*` in `cwl_lx.h`) + `tools/espnow_shim/cwl_espnow_shim`
(runs `cwl_lx.c` on the Mac, UDP to `cwl_peer`). `tools/espnow_shim/air_sim.py` +
`e2e_sim.sh` run the whole path with simulated boards (ptys). Test plan:
`tools/espnow_bridge/README.md`.

## Choosing the Wi-Fi network (ESP 0.16+)

SYSTEM > WI-FI and `components/cwl/cwl_net.c`. Up to 5 saved networks (NVS `cwlnet`,
newest first); the one the link joins stays in NVS `cwl` ssid/pass as before (older
builds read it). A scan, a join or phone setup takes the radio: the link session pauses
(`CWL_NetHold`), Wi-Fi is driven by cwl_net alone, and the session restarts on the
result. A network is saved and made current only after it gave an address; otherwise
the old one stays. Failure reasons come from the station's disconnect reason: auth
failures (2 in a row) = WRONG PASSWORD, `NO_AP_FOUND` = NETWORK NOT FOUND, association
refusals = NETWORK REFUSED US, joined without DHCP = NO IP ADDRESS. Auto-join: after 3
failed joins of the current network the link task scans (at most every 30 s) and moves
to the strongest saved network in range.

**Phone setup.** A temporary access point `ShinyRelay-XXXX` (last two MAC bytes), WPA2
with a fresh 8-letter password shown on the OSD (and as a `WIFI:` QR code), beside the
station (APSTA). It answers every DNS question with 192.0.2.1 and redirects every
unknown URL there, so phones open the page by themselves. The page lists the scanned
networks (or a typed name) and a password; the Chromatic moves its access point to the
target network's channel (one radio: an access point on another channel made the
station lose beacons and drop, reason 200), joins, reports on `/status`, saves and closes
8 s after success, or after 5 minutes. The server is a minimal HTTP/1.0 loop inside the
setup task (no extra task); measured heap: 28.0 KB with the link held, 25.9 KB with the
station up, 18.8 KB with the access point, 17.1-17.3 KB with the page and DNS running
(esp_http_server instead: 10.5 KB). `cwl net portal lan` keeps the station on the
current network so the page can be tested from the LAN (done: page 1.4 KB in 0.12 s,
captive redirects, DNS, a join of a missing network answered "not found" and the
station went back). Passwords: NVS and firmware only; the console prints SSIDs and
"password_set"; the page never echoes one.

## SHLINK: a Shiny Gen game's room (ESP 0.17+)

Not the link port: a Shiny Gen GBC game with the SHLINK helper v1.1 moves its
CartridgeLink mailbox through the network window (NETWORK_WINDOW.md, FPGA 18.21+)
once a frame. The ESP32 answers the window ops 0x0B LINK_JOIN / 0x0C LINK_XCHG /
0x0D LINK_LEAVE itself (`mcu/components/nw/nw_link.c`, CartridgeLink's session/ack
rules) and holds the game's room on Shiny Relay with its own UDP socket
(`shl_client.c`: SJOIN 0x60 with a pairing ticket, SWELCOME 0x61, SDATA 0x62, reliable
in-order items, go-back-N, ack = flow control, rejoin by room id). Design and the relay
side: shiny_gen_3 `notes/SHLINK_ON_CHROMATIC.md` section 8.

* Room: from the OSD (SYSTEM > NETWORK is the game's room menu while it runs) or the
  console `nw room host|mine|join <code>|leave`; the app's last instruction (join code,
  "Invite my Chromatic") is taken on the game's lk_ask.
* The client and its buffer exist only while a SHLINK game is attached or a room is
  live (heap, 3.8 KB); full power only while a room is live.
* It is independent of the LINK CABLE mode (a link-port game and a SHLINK game are
  different games); both take tickets from the same spare-ticket path.
* Hardware test without an SD ROM: `tools/nw/bootrom/shltest_boot.inc` (TEST-ONLY
  boot ROM, `make_shltest.sh`, bitstream `fpga/esp32t/build/evt1_x2_nwin_shltest.fs`
  via `run/build_shltest.sh`; SRAM load only, `run/shl_hw_run.sh CODE`) against
  `mcu/components/nw/host/shl_echo` hosting CODE. Measured 2026-10-10 (round trip of a
  2-byte message, GB timer): prod relay 48/48, p50 102 ms, p95 135 ms, max 196 ms;
  beta relay 72/72, p50 134 ms, p95 187 ms. An SRAM load resets the ESP32 (and so does
  opening the console): the test joins again on NOT_IDENTIFIED.

## Bluetooth LE (parked)

Parked by the owner on 2026-10-10 (Wi-Fi only for now): `mcu/components/cwl/parked/`
(not built, no RAM or flash cost) has the NimBLE transport and its README: GATT service
`43574C32-B1E0-4C49-4E4B-000000000000` (C2P write-without-response, P2C notify, STAT
read), the same frames as ESP-NOW, and the RAM finding that decides its shape: the BT
controller reserves 56 KB of DRAM, more than the heap left beside Wi-Fi + TLS, so a
Bluetooth mode must run with Wi-Fi off and switching into or out of it needs an ESP32
restart. Its future job is the link to the Shiny Gen phone app (Chromatic = peripheral).

## Send-ahead (CWL2 extension, lane linkperf1; ESP 0.17.4+ code, needs FPGA 18.23 to lend)

**FPGA numbering (2026-10-11).** 18.22 is the run-time patch overlay build (it has no slave lock).
The slave lock is **18.23**: built on 18.21 as `fpga_patch` branch `sa1823` (send-ahead test build),
and on the overlay as branch `fpga1823`. Firmware lends only with FPGA minor >= 23. This section
said 18.22 until the lock was built.

**Why.** In CWL2 a master transfer costs one network round trip at the port (REQ, the
slave's port decides, ACK). A real cable costs 1 ms. A game that sends a byte per frame and
rewrites the port on the next frame (ModRetro Tetris Battle does exactly that) hits the
write barrier as soon as the hold passes ~15.7 ms, and every such frame is a CPU stall (a
lost frame). A fast-clock master (SMB Deluxe) stalls the CPU for the whole hold, every byte.
Measured on two Chromatics (Tetris Battle, Nearby, 0.17.1/0.17.2): exchange RTT p50 16-17 ms
at the ESP, 739 abandons per 817 masters.

**Idea.** When the slave's game arms its port (SC = 0x80, SB set) the slave side lends that
byte to the master side ahead of time. If the master's game starts a transfer while a valid
lent byte is there, the master completes at once (a UART round trip, ~1.2 ms) and sends its
own byte to the slave, which delivers it to its still-armed port.

**The one rule that keeps it desync-free: a lent port is locked.** The master completes its
game's transfer the instant it takes the lent byte; that cannot be undone. So from the
moment a byte is lent until the slave knows its fate, the slave's port must not change: the
FPGA locks it (18.23, below) and any SB / SC write the game makes is parked with the CPU
stalled, exactly like the CWL2 master write barrier. Then the slave asks (REVOKE) and the
master answers: taken (its TAKE, delivered to the parked port, IRQ, then the parked write
lands; as on hardware, where the peer's clock came first) or not taken (REVOKED: the master
promises never to take it, the parked write lands, no exchange). The slave's port stays the
authority, as in CWL2.

**Packets** (same 6-byte CWL2 format, version 2; a CWL2 peer ignores the types):

| type | name | dir | meaning |
|---|---|---|---|
| 7 | CAPS | both | `seq` = capability bits (bit 0 send-ahead), `byte` = low byte of the sender's session |
| 8 | PUSH | slave -> master | my locked port's byte (`byte`) for master seq `seq` (= newest seq seen + 1); resent every 20 ms |
| 9 | TAKE | master -> slave | I took the PUSH for `seq`; `byte` = master byte: deliver it. Resent until its ACK; never cancelled |
| 10 | REVOKE | slave -> master | my game rewrote the lent port (parked): give `seq` up if not taken |
| 11 | REVOKED | master -> slave | `seq` was not taken and never will be |
| 12 | WANT | master -> slave | `seq` = 1: my game's masters are being abandoned (holds cost frames), lend more freely |

**Rules.**
* Sequence numbers: a PUSH names the master seq it may answer (the slave's newest seen + 1).
  The master takes it only for exactly `m_seq + 1`, so a late or duplicate PUSH (seq already
  used through a REQ, or cancelled) is ignored; jitter and reordering cannot make a stale
  byte usable. After REVOKED(t) the slave never lends for t again (a delayed copy of the old
  PUSH(t) arriving after the REVOKE is then rejected on its seq).
* A REQ (or TAKE) for the lent seq exchanges the locked port (the master did not have the
  PUSH and asked the CWL2 way: same result). A REQ for a newer seq also exchanges it (the
  master never took the lent one: it cannot send a newer request while a TAKE is open).
* One TAKE at a time: a transfer the master's game starts while its TAKE is unacknowledged
  waits (WaitTake). A PUSH for the next seq proves the TAKE was delivered (the slave lends
  only for newest + 1, and a TAKE is never cancelled) and is used at once; else, after the
  ACK, the master waits up to 8 ms for the next PUSH before asking with a REQ (the slave
  lends again a UART round trip after its game re-arms). When PUSHes have lately been
  arriving just after its own REQs (within 8 ms), the master also waits up to 4 ms at a
  start for one (jitter: SMB Deluxe's slave re-arms about as the master starts).
* Late take (linkperf2): a PUSH for the seq of the REQ that is in flight (state Requesting, not
  cancelling, not revoked) is taken too: the slave's port is locked on that byte and the REQ, from
  then on resent as TAKE and never cancelled, is exchanged there. (SMB Deluxe's master restarts
  1 ms after each reply: on two units 2457 of 3099 lends arrived just after their REQ had left.)
  A REVOKE of the in-flight seq that was not taken marks it, so a late copy of its PUSH is refused.
* Lend only inside a request stream (linkperf2): the last two new peer requests under 40 ms
  apart and the last under 40 ms ago, as well as WANT. A lone handshake byte never gets a lend
  (SMB Deluxe's VS GAME entry: the lend nobody took parked the next frame's port write for a
  round trip and the handshake timed out). A lend not taken within 6 ms is asked back in the
  background (REVOKE without a parked write): a later rewrite waits only for the rest of the
  answer. Turning send-ahead off changes the session (unsigned), so the partner stops lending.
* CANCEL for the lent seq (its REQ was lost): CANCELLED, and the still-locked port is lent
  again for the next seq; a REVOKE in progress then simply ends (unlock).
* The master answers REVOKE for a TAKE it sent by sending the TAKE again (it must land).
* Restarted transfers, stop-then-restart (absorb), standing offers, collisions and the CWL2
  master write barrier are unchanged; a locked port is armed, so an offer exchanges it at once.
* Peer gone (2 s) or a new peer session: the lock is given back, TAKE / PUSH state dropped.
* **Negotiation**: a side with send-ahead on marks its HELLO session (low byte =
  `(high * 7 + 0x5A) & 0xFF`) and sends CAPS only to a peer whose session carries the mark,
  at most 10 times per peer session, plus once in answer to the peer's CAPS. A side lends
  only to a peer that sent CAPS bit 0 in its current session, and only with its own FPGA lock;
  it takes a peer's PUSHes with any FPGA. A CWL2 peer (older firmware, `tools/cwl_peer`, the
  app's vendored core) never sends CAPS, so the link stays CWL2; it sees at most 10 CAPS, and
  only on a 1 in 256 session coincidence (CWL2 ESP firmware counts any non-HELLO packet as
  link use: that is why CAPS is not sent periodically to everyone).
* **When to lend** (a revoke costs the slave's game a parked round trip): only while the
  master side says WANT, i.e. its game's masters are being abandoned (rewritten under the
  hold: lost frames) or run on the CGB fast clock (the CPU stalls for the whole hold; FPGA
  18.23 reports those as event 11), within the last 2 s. A master whose game just waits out
  the hold (Tetris DX, linktest, ModRetro Tetris below a frame of round trip) loses nothing
  to CWL2, so its peer does not lend. Even with WANT the slave stops for 64 arms when half
  of its last lends were revoked (ModRetro Tetris keeps both ports armed and whoever starts
  first is master: a lent port is revoked at every role swap). WANT is sent on a change and
  repeated with each HELLO, only to a peer that sent CAPS. Arms shorter than the LOCK round
  trip (Gen 2's partner search, ~20 us) are never lent (LOCK_NAK).

**What it can and cannot do.** It removes the round trip only when the slave arms before the
master starts by more than the one-way latency. A byte stream where each byte follows the
previous exchange cannot go faster than one exchange per round trip with any desync-free
protocol (the slave's port can be re-armed only after it got the previous byte); there the
WaitTake / PUSH pipelining still trims the hold to (round trip - period). Simulated results:
`mcu/docs/LINKPERF1_REPORT.md` / `docs/LINKPERF1_REPORT.md`.

**FPGA 18.23: the slave lock** (built 2026-10-11, lane fpgapatch1: `link.v`, `link_net_cdc.v`; `sim_cwl/tb_link_net.v` 102 checks). CONFIG bit 4 enables it (the ESP
handles cmds 7/8 and events 8-10); without the bit the port is 18.21.

| | |
|---|---|
| cmd 7 SLAVE_LOCK | if the port is armed as slave (start set, external clock, no held master, no parked write): lock it, event 8 LOCKED(SB); else event 9 LOCK_NAK(SB) |
| while locked | a CPU write to SB or SC is parked (as the barrier's `pw_valid`), the CPU stalled (`net_cpu_stop`), event 10 SLAVE_ABANDON(written value) |
| cmd 2 SLAVE_XFER on a locked port | exchanges (it is armed), IRQ, SLAVE_DONE(SB shifted out), lock cleared; a parked write lands right after (the barrier's `pw_apply`) |
| cmd 8 SLAVE_UNLOCK | lock cleared; a parked write lands; no event |
| also cleared | CONFIG bit 4 or `net_en` off, reset; and after ~4 s with a write parked (dead-ESP safety net: unlock, land the write) |
| event 11 MASTER_FAST | with bit 4 set, a master started on the CGB fast clock is reported as 11 instead of 3 (same byte) |
| events 8-11 | never dropped from the 16-deep queue (like MASTER); `net_ev_type` becomes 4 bits |

Optional later: auto-lock on arm while bit 4 is set (saves a UART round trip per lend), and a
master preload (the ESP hands the FPGA the lent byte so a master start completes in the same
cycle; a REVOKE is then answered only after the FPGA says whether it used it).

## Measuring: `cwl xstat` (ESP 0.17.4+)

`cwl xstat reset` before a match, `cwl xstat` after (also reset at each link session start):
exchanges per 1 s window (last 8, max), master hold (MASTER event to reply / drop) and CPU park
(ABANDON to verdict, or a lent port's rewrite to its verdict) histograms in <1/<8/<17/<33/>=33
ms, frames (16.74 ms windows) parked more than half (lost frames), the last 8 abandons (ms
since reset: since the master start / parked, SB, outcome A ack / C cancelled / N nothing sent /
U unknown master / T taken), the slave's port when a peer request arrives (armed, lent, waited
<1..>=33 ms, refused), the exchange round trip (REQ to ACK / CANCELLED) histogram, send-ahead
counters, and the power line (level now, ms per level since the reset, REQ/ACK sent below
full power, Wi-Fi power-save fixes, ESP-NOW tx/fail/rx/drop). Times are taken on the ESP32:
the port sees ~1-2 ms more (UART).

**0.17.4 (part A)**: the link task waits for work (an FPGA event or an ESP-NOW frame wakes it,
its packet goes out in the same pass; 0.17.2 lost up to a tick on each), the FPGA UART RX
timeout is 1 symbol (was 10: ~0.8 ms per port event), and at full power Wi-Fi power save is
re-checked every second. Simulated: ~5 ms less per exchange at the port.

## Where a nearby exchange spends its time: `cwl xlat` (ESP 0.17.9-patch8-cart2-sa3, lane linkperf3)

Budget of one NEARBY exchange with the slave armed, from the code (ESP 0.17.4+ link task, FreeRTOS
tick 1 kHz, UART 115200 8N1, 6-byte packets = 0.52 ms each, RX timeout 1 symbol):

| step | where | expected |
|---|---|---|
| MASTER event to the ESP32 | FPGA UART | 0.52 + 0.09 ms |
| link task wake, REQ built, `esp_now_send` | master ESP32 | ~0.1-0.2 ms |
| radio hop H: driver queue, DIFS + backoff, frame at 1 Mbps (long preamble 192 us + ~49 bytes), SIFS, ACK | air | ~1.3 ms air + driver, with no contention and no retry |
| receive callback to link task, SLAVE_XFER to the FPGA | slave ESP32 + UART | ~0.1 + 0.52 ms |
| SLAVE_DONE back | FPGA UART | 0.52 + 0.09 ms |
| ACK: second radio hop | air | H |
| MASTER_REPLY to the FPGA | UART | 0.52 ms |

Port hold = 2 H + ~2.7 ms; exchange RTT as xstat sees it (REQ to ACK) = 2 H + ~1.3 ms. With
H = 1.7 ms that is ~6 ms / ~4.7 ms. Two units measured 8-17 ms for most armed exchanges, so H
is 3.5-8 ms there, not 1.7: the excess is in the radio hop (channel access behind the home AP's
and neighbours' traffic, MAC retries at 1 Mbps, the Wi-Fi driver), or the UART/FPGA leg is slower
than computed. `cwl xlat` (reset with `cwl xlat reset`) measures each leg on a unit: `radio hop`
(esp_now_send to the send callback) histogram / average / maximum, `frame: receive callback ->
link task`, `port event: UART RX task -> link task`, `port round trip (SLAVE_XFER -> SLAVE_DONE)`
(expected ~1.2-1.4 ms), `link task pass work`, `ping round trip` in microseconds with its minimum
(expected about 2 x radio hop + 0.3 ms), and the Wi-Fi power-save mode (must be 0 at full power),
association, channel, ESP-NOW rate. Test knobs: `cwl espnow rate <1|2|5|11|6|12|24>` (PHY rate of
our ESP-NOW frames, not saved), `cwl espnow apjoin off` (no AP: are the AP's channel and its
traffic the cost?).

## Chromatic internals

`FPGA <-> ESP32` over the existing packet UART (115200, header `0x8F`, CRC-8 J1850).

FPGA -> ESP32, TX channel 10 (address `0x0A`), 2 bytes `[event, byte]`:

| event | meaning |
|-------|---------|
| 1 ARMED      | game armed as slave (`byte` = SB) |
| 2 DISARM     | game cancelled its armed transfer |
| 3 MASTER     | game started a master transfer with `byte`; FPGA is holding |
| 4 SLAVE_DONE | offered byte accepted; `byte` = SB shifted out |
| 5 SLAVE_NAK  | offered byte refused: not armed |
| 6 ABANDON    | SB/SC written under the held master; CPU stalled, write parked (FPGA write barrier) |
| 7 SLAVE_NAK_STALLED | offer refused while the port holds a master with the CPU stalled: master collision, the ESP asks the verdict at once (both sides read `0xFF`) |
| 8 LOCKED | (18.23) SLAVE_LOCK took: `byte` = SB the locked port will shift out |
| 9 LOCK_NAK | (18.23) SLAVE_LOCK refused: not armed |
| 10 SLAVE_ABANDON | (18.23) SB/SC written under the lock: parked, CPU stalled; `byte` = written value |
| 11 MASTER_FAST | (18.23, bit 4) MASTER on the CGB fast clock (the CPU stalls for the hold) |

The FPGA queues up to 16 events (18.17; 4 before), each a ~0.5 ms UART packet.
Pokemon Gold/Silver's partner search writes SB=2, SC=0x00, SC=0x80, SB=1,
SC=0x01, SC=0x81 within ~20 us (ARMED DISARM ARMED ARMED DISARM MASTER): the
4-deep queue dropped the `MASTER`, so the ESP32 ignored the next frame's
`ABANDON`, the CPU stalled ~4 s (the music slowed), and the safety timeout's
`0xFF` + IRQ landed under the parked `SB = 2`: the game read its own `0x02` as the
partner's and "connected" alone, then closed the link for inactivity. `ARMED` /
`DISARM` are hints, so with 12 or more events queued they are dropped to keep
room for the rest.

ESP32 -> FPGA, RX address `0x10`, 2 bytes `[cmd, byte]`:

| cmd | meaning |
|-----|---------|
| 1 MASTER_REPLY | complete the held master transfer with `byte` |
| 2 SLAVE_XFER   | offer the peer master's `byte` (answered by SLAVE_DONE / SLAVE_NAK) |
| 3 CONFIG       | `byte` bit 0 = Wi-Fi link enabled (physical port ignored); bit 1 = the ESP32 may be in light sleep: send the wake preamble before each packet (FPGA 18.15+); bit 2 = the ESP32 handles `ABANDON` / `MASTER_DROP` / event 7, so the FPGA may use the write barrier and the fast-clock stall (FPGA 18.16+; without it the FPGA behaves as 18.15, so a new FPGA under an older ESP32 build never stalls the CPU waiting for a verdict that will not come); bit 3 = standing offers (18.20+, the ESP32 withdraws them with cmd 6) |
| 4 MASTER_DROP  | release the held (abandoned) master without completing it: no IRQ, SB untouched; then the parked write applies |
| 6 SLAVE_WITHDRAW | take back the standing offer (18.20+): `SLAVE_NAK` if it still waited, no event if it was exchanged |
| 5 CART_POWER_CYCLE | debug (18.18+, console `cwl cartcycle`): cartridge power off ~1 s as the power switch would, so a flash cart returns to its menu (a soft reset or an FPGA reload keeps the cart powered and replays the loaded game) |
| 7 SLAVE_LOCK | (18.23, CONFIG bit 4) lock the armed slave port for send-ahead: LOCKED / LOCK_NAK |
| 8 SLAVE_UNLOCK | (18.23) end the lock; a parked write lands |

The FPGA also completes a held master transfer with `0xFF` after ~4 s of no
reply (safety net for a dead ESP32). From 18.16 that is ~4 s in CGB double
speed too (it counted CPU ticks, so it was ~2 s there: shorter than the ESP32's
wake hold plus master timeout, 2 + 1.5 s, which assumes 4 s).
