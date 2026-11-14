/* tslint:disable */
/* eslint-disable */

export class InterpreterResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    get ah(): number | undefined;
    set ah(value: number | null | undefined);
    get halt(): boolean | undefined;
    set halt(value: boolean | null | undefined);
    get int(): number | undefined;
    set int(value: number | null | undefined);
}

export class JSFlags {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    af: number;
    cf: number;
    df: number;
    iflag: number;
    of: number;
    pf: number;
    sf: number;
    tf: number;
    zf: number;
}

export class JSReg {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    ah: number;
    al: number;
    bh: number;
    bl: number;
    bp: number;
    ch: number;
    cl: number;
    dh: number;
    di: number;
    dl: number;
    ds: number;
    es: number;
    si: number;
    sp: number;
    ss: number;
}

export class WebDriver {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    get_flags(): JSFlags;
    get_int_21(): any;
    get_mem(start: number, end: number): Uint8Array;
    get_reg(): JSReg;
    get_state_snapshot(): any;
    int_10(): any;
    next(): InterpreterResult;
    set_int_21(input: string): void;
    line: number;
}

export function preprocess(input: string): WebDriver;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_get_interpreterresult_ah: (a: number) => number;
    readonly __wbg_get_interpreterresult_halt: (a: number) => number;
    readonly __wbg_get_interpreterresult_int: (a: number) => number;
    readonly __wbg_get_jsflags_af: (a: number) => number;
    readonly __wbg_get_jsflags_cf: (a: number) => number;
    readonly __wbg_get_jsflags_df: (a: number) => number;
    readonly __wbg_get_jsflags_iflag: (a: number) => number;
    readonly __wbg_get_jsflags_of: (a: number) => number;
    readonly __wbg_get_jsflags_pf: (a: number) => number;
    readonly __wbg_get_jsflags_sf: (a: number) => number;
    readonly __wbg_get_jsflags_tf: (a: number) => number;
    readonly __wbg_get_jsflags_zf: (a: number) => number;
    readonly __wbg_get_jsreg_ah: (a: number) => number;
    readonly __wbg_get_jsreg_al: (a: number) => number;
    readonly __wbg_get_jsreg_bh: (a: number) => number;
    readonly __wbg_get_jsreg_bl: (a: number) => number;
    readonly __wbg_get_jsreg_bp: (a: number) => number;
    readonly __wbg_get_jsreg_ch: (a: number) => number;
    readonly __wbg_get_jsreg_cl: (a: number) => number;
    readonly __wbg_get_jsreg_dh: (a: number) => number;
    readonly __wbg_get_jsreg_di: (a: number) => number;
    readonly __wbg_get_jsreg_dl: (a: number) => number;
    readonly __wbg_get_jsreg_ds: (a: number) => number;
    readonly __wbg_get_jsreg_es: (a: number) => number;
    readonly __wbg_get_jsreg_si: (a: number) => number;
    readonly __wbg_get_jsreg_sp: (a: number) => number;
    readonly __wbg_get_jsreg_ss: (a: number) => number;
    readonly __wbg_get_webdriver_line: (a: number) => number;
    readonly __wbg_interpreterresult_free: (a: number, b: number) => void;
    readonly __wbg_jsflags_free: (a: number, b: number) => void;
    readonly __wbg_jsreg_free: (a: number, b: number) => void;
    readonly __wbg_set_interpreterresult_ah: (a: number, b: number) => void;
    readonly __wbg_set_interpreterresult_halt: (a: number, b: number) => void;
    readonly __wbg_set_interpreterresult_int: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_af: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_cf: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_df: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_iflag: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_of: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_pf: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_sf: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_tf: (a: number, b: number) => void;
    readonly __wbg_set_jsflags_zf: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_ah: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_al: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_bh: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_bl: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_bp: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_ch: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_cl: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_dh: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_di: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_dl: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_ds: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_es: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_si: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_sp: (a: number, b: number) => void;
    readonly __wbg_set_jsreg_ss: (a: number, b: number) => void;
    readonly __wbg_set_webdriver_line: (a: number, b: number) => void;
    readonly __wbg_webdriver_free: (a: number, b: number) => void;
    readonly preprocess: (a: number, b: number) => [number, number, number];
    readonly webdriver_get_flags: (a: number) => number;
    readonly webdriver_get_int_21: (a: number) => any;
    readonly webdriver_get_mem: (a: number, b: number, c: number) => [number, number];
    readonly webdriver_get_reg: (a: number) => number;
    readonly webdriver_get_state_snapshot: (a: number) => any;
    readonly webdriver_int_10: (a: number) => any;
    readonly webdriver_next: (a: number) => [number, number, number];
    readonly webdriver_set_int_21: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
