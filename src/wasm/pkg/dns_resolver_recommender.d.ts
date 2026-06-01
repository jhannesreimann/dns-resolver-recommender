/* tslint:disable */
/* eslint-disable */

export class MeasurementResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    latency_ms: number;
    readonly status: string;
}

/**
 * Measures a single DoH request with a configurable timeout.
 * Returns latency in ms and "ok" if NOERROR and an A record was returned.
 * On timeout, returns status "Timeout" with 0 latency.
 */
export function measure_resolver(doh_url: string, domain: string, allow_cors: boolean, timeout_ms: number): Promise<MeasurementResult>;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_measurementresult_latency_ms: (a: number) => number;
    readonly __wbg_measurementresult_free: (a: number, b: number) => void;
    readonly __wbg_set_measurementresult_latency_ms: (a: number, b: number) => void;
    readonly measure_resolver: (a: number, b: number, c: number, d: number, e: number, f: number) => any;
    readonly measurementresult_status: (a: number) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__hee085993e1047631: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h54de09293abacf2d: (a: number, b: number, c: any, d: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
