/** Deterministic packing for immutable records that must not straddle a ROM bank.
 * The caller owns mapper numbering, directory encoding and target alignment. */
export interface BankRecordLocation { readonly bank: number; readonly offset: number }
export interface PackedBankRecords {
  readonly banks: readonly Uint8Array[];
  /** Locations retain input IDs even though storage is sorted by size. */
  readonly locations: readonly BankRecordLocation[];
  readonly payloadBytes: number;
  readonly paddingBytes: number;
}
export function packBankRecords(records: readonly Uint8Array[], bankBytes: number): PackedBankRecords {
  if (!Number.isSafeInteger(bankBytes) || bankBytes < 1) throw new Error('invalid ROM bank size');
  const order = records.map((record, id) => {
    if (!(record instanceof Uint8Array) || !record.length || record.length > bankBytes)
      throw new Error(`record ${id} does not fit one ROM bank`);
    return id;
  }).sort((a, b) => records[b]!.length - records[a]!.length || a - b);
  const banks: Uint8Array[] = [], used: number[] = [], locations: BankRecordLocation[] = [];
  let payloadBytes = 0;
  for (const id of order) {
    const record = records[id]!;
    let bank = used.findIndex(n => n + record.length <= bankBytes);
    if (bank < 0) { bank = banks.length; banks.push(new Uint8Array(bankBytes)); used.push(0); }
    const offset = used[bank]!;
    banks[bank]!.set(record, offset); used[bank] = offset + record.length;
    locations[id] = { bank, offset }; payloadBytes += record.length;
  }
  return { banks, locations, payloadBytes, paddingBytes: banks.length * bankBytes - payloadBytes };
}
