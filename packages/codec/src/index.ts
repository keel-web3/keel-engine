// @keel-engine/codec: the bit codec. A typed schema DSL (t.uint, t.fixed,
// t.enum, t.struct, t.union, t.ref, t.delta, t.runs...), a canonical
// bit-packed encoding with errors that name the field, schemas that encode
// themselves (so documents can carry theirs, or name it by its hash), a
// registry, a lossless JSON view, explainBits for the editor's bit
// inspector, evolution checks -- and the engine's own schemas. On a page,
// setup(ctx) registers those and every module manifest's embedded schemas.

export { BitError, BitReader, BitWriter, bitsFor, fromHalf, toHalf } from "./bits.ts";
export {
  KINDS, SchemaError, alt, array, asNode, biguint, bool, bytes, categoryOf, constant, delta, dyn, enumOf, extend, fixed, float16, float32, float64, grow, hex, int,
  lz, map, mapChildren, named, nullable, num, optional, planes, recursive, ref, runs, string, struct, t, tuple, uint, union, varint, varuint, withDefault,
} from "./schema.ts";
export type {
  AltNode, ArrayNode, BigNode, BoolNode, BytesNode, Category, ConstNode, DefaultNode, DeltaNode, DynNode, EnumNode, Field, FixedNode, FloatNode, GrowNode, HexNode, Infer,
  IntNode, Json, Kind, Lit, LzNode, MapNode, NamedNode, Node, NullableNode, NumNode, OffGrid, OptionalNode, PlanesNode, RecNode, RefNode, RunsNode, SelfNode, StringNode,
  StructNode, StructType, StructValue, TupleNode, Type, UintNode, UnionNode, VarNode,
} from "./schema.ts";
export { CodecError, Tables, createTables, decodeRaw, encodeRaw, finishReading, gridOf, holds, pathText, readValue, same, sizeOf, validate, valueCategory, writeValue } from "./codec.ts";
export type { DecodeOptions, EncodeOptions, Grid, Tracer } from "./codec.ts";
export { SCHEMA_SCHEMA, decodeSchema, encodeSchema, fromRecord, schemaId, schemaName, shortId, toRecord } from "./canonical.ts";
export type { SchemaRecord } from "./canonical.ts";
export { HEADER_ID, HEADER_SELF, createRegistry, decode, defaultRegistry, encode, fromBase64, lookupSchema, readDocument, readHeader, registerEntries, registerSchema, schemaEntry, toBase64 } from "./document.ts";
export type { DocumentDecodeOptions, DocumentEncodeOptions, Header, HeaderMode, RegisteredSchema, Registry, SchemaEntryLike } from "./document.ts";
export { pendingSchemas, registerManifests, schemaLoadReport, setup } from "./load.ts";
export type { ManifestLike, SchemaLoadReport, SetupContext } from "./load.ts";
export { compatibility } from "./evolve.ts";
export type { Compatibility } from "./evolve.ts";
export { fromJSON, toJSON } from "./json.ts";
export { costs, explainBits, nodeAtBit, typeText } from "./explain.ts";
export type { BitExplanation, BitNode, BitRole } from "./explain.ts";
export { sha256, toHex } from "./sha256.ts";
export { solidityDecoder } from "./solidity.ts";
export type { SolidityOptions } from "./solidity.ts";
export * from "./schemas/index.ts";

// Bounded native sprite compression: shared by cartridge ROM and battery cache.
export {RETRO_CODEC_VERSION,encodeRetroFrame,decodeRetroFrame,encodeRetroClip,encodeRetroClipAdaptive,decodeRetroClipFrame,encodeRetroAsset,decodeRetroAssetFrame} from './retro.ts';
export type {RetroClip,RetroAsset} from './retro.ts';

export { encodeFloat32Runs, decodeFloat32Runs } from "./procedural-buffer.ts";

export {RETRO_CTX_VERSION,CTX_SIZE,CTX_CLASSES,CTX_PLPS,CTX_QTAB,CTX_MODEL_BYTES,ctxClassOf,encodeCtxModel,decodeCtxModel,ctxModelId,ctxPixels,ctxTiles,ctxOf,encodeCtxChain,decodeCtxChain,trainCtxModel,encodeCtxClip,decodeCtxClip} from './retro-ctx.ts';
export type {CtxModel,CtxFrame,CtxClip,CtxClipCode} from './retro-ctx.ts';

export { packBankRecords } from './rom-banks.ts';
export type { BankRecordLocation, PackedBankRecords } from './rom-banks.ts';
