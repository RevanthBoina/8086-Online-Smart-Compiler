/* @ts-self-types="./emulator_8086_web.d.ts" */

export class InterpreterResult {
    static __wrap(ptr) {
        const obj = Object.create(InterpreterResult.prototype);
        obj.__wbg_ptr = ptr;
        InterpreterResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InterpreterResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_interpreterresult_free(ptr, 0);
    }
    /**
     * @returns {number | undefined}
     */
    get ah() {
        const ret = wasm.__wbg_get_interpreterresult_ah(this.__wbg_ptr);
        return ret === 0xFFFFFF ? undefined : ret;
    }
    /**
     * @returns {boolean | undefined}
     */
    get halt() {
        const ret = wasm.__wbg_get_interpreterresult_halt(this.__wbg_ptr);
        return ret === 0xFFFFFF ? undefined : ret !== 0;
    }
    /**
     * @returns {number | undefined}
     */
    get int() {
        const ret = wasm.__wbg_get_interpreterresult_int(this.__wbg_ptr);
        return ret === 0xFFFFFF ? undefined : ret;
    }
    /**
     * @param {number | null} [arg0]
     */
    set ah(arg0) {
        wasm.__wbg_set_interpreterresult_ah(this.__wbg_ptr, isLikeNone(arg0) ? 0xFFFFFF : arg0);
    }
    /**
     * @param {boolean | null} [arg0]
     */
    set halt(arg0) {
        wasm.__wbg_set_interpreterresult_halt(this.__wbg_ptr, isLikeNone(arg0) ? 0xFFFFFF : arg0 ? 1 : 0);
    }
    /**
     * @param {number | null} [arg0]
     */
    set int(arg0) {
        wasm.__wbg_set_interpreterresult_int(this.__wbg_ptr, isLikeNone(arg0) ? 0xFFFFFF : arg0);
    }
}
if (Symbol.dispose) InterpreterResult.prototype[Symbol.dispose] = InterpreterResult.prototype.free;

export class JSFlags {
    static __wrap(ptr) {
        const obj = Object.create(JSFlags.prototype);
        obj.__wbg_ptr = ptr;
        JSFlagsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JSFlagsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsflags_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get af() {
        const ret = wasm.__wbg_get_jsflags_af(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get cf() {
        const ret = wasm.__wbg_get_jsflags_cf(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get df() {
        const ret = wasm.__wbg_get_jsflags_df(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get iflag() {
        const ret = wasm.__wbg_get_jsflags_iflag(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get of() {
        const ret = wasm.__wbg_get_jsflags_of(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get pf() {
        const ret = wasm.__wbg_get_jsflags_pf(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get sf() {
        const ret = wasm.__wbg_get_jsflags_sf(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get tf() {
        const ret = wasm.__wbg_get_jsflags_tf(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get zf() {
        const ret = wasm.__wbg_get_jsflags_zf(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set af(arg0) {
        wasm.__wbg_set_jsflags_af(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set cf(arg0) {
        wasm.__wbg_set_jsflags_cf(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set df(arg0) {
        wasm.__wbg_set_jsflags_df(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set iflag(arg0) {
        wasm.__wbg_set_jsflags_iflag(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set of(arg0) {
        wasm.__wbg_set_jsflags_of(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set pf(arg0) {
        wasm.__wbg_set_jsflags_pf(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set sf(arg0) {
        wasm.__wbg_set_jsflags_sf(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set tf(arg0) {
        wasm.__wbg_set_jsflags_tf(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set zf(arg0) {
        wasm.__wbg_set_jsflags_zf(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) JSFlags.prototype[Symbol.dispose] = JSFlags.prototype.free;

export class JSReg {
    static __wrap(ptr) {
        const obj = Object.create(JSReg.prototype);
        obj.__wbg_ptr = ptr;
        JSRegFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        JSRegFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_jsreg_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get ah() {
        const ret = wasm.__wbg_get_jsreg_ah(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get al() {
        const ret = wasm.__wbg_get_jsreg_al(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get bh() {
        const ret = wasm.__wbg_get_jsreg_bh(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get bl() {
        const ret = wasm.__wbg_get_jsreg_bl(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get bp() {
        const ret = wasm.__wbg_get_jsreg_bp(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get ch() {
        const ret = wasm.__wbg_get_jsreg_ch(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get cl() {
        const ret = wasm.__wbg_get_jsreg_cl(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get dh() {
        const ret = wasm.__wbg_get_jsreg_dh(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get di() {
        const ret = wasm.__wbg_get_jsreg_di(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get dl() {
        const ret = wasm.__wbg_get_jsreg_dl(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get ds() {
        const ret = wasm.__wbg_get_jsreg_ds(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get es() {
        const ret = wasm.__wbg_get_jsreg_es(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get si() {
        const ret = wasm.__wbg_get_jsreg_si(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get sp() {
        const ret = wasm.__wbg_get_jsreg_sp(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    get ss() {
        const ret = wasm.__wbg_get_jsreg_ss(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} arg0
     */
    set ah(arg0) {
        wasm.__wbg_set_jsreg_ah(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set al(arg0) {
        wasm.__wbg_set_jsreg_al(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set bh(arg0) {
        wasm.__wbg_set_jsreg_bh(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set bl(arg0) {
        wasm.__wbg_set_jsreg_bl(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set bp(arg0) {
        wasm.__wbg_set_jsreg_bp(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set ch(arg0) {
        wasm.__wbg_set_jsreg_ch(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set cl(arg0) {
        wasm.__wbg_set_jsreg_cl(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set dh(arg0) {
        wasm.__wbg_set_jsreg_dh(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set di(arg0) {
        wasm.__wbg_set_jsreg_di(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set dl(arg0) {
        wasm.__wbg_set_jsreg_dl(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set ds(arg0) {
        wasm.__wbg_set_jsreg_ds(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set es(arg0) {
        wasm.__wbg_set_jsreg_es(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set si(arg0) {
        wasm.__wbg_set_jsreg_si(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set sp(arg0) {
        wasm.__wbg_set_jsreg_sp(this.__wbg_ptr, arg0);
    }
    /**
     * @param {number} arg0
     */
    set ss(arg0) {
        wasm.__wbg_set_jsreg_ss(this.__wbg_ptr, arg0);
    }
}
if (Symbol.dispose) JSReg.prototype[Symbol.dispose] = JSReg.prototype.free;

export class WebDriver {
    static __wrap(ptr) {
        const obj = Object.create(WebDriver.prototype);
        obj.__wbg_ptr = ptr;
        WebDriverFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WebDriverFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_webdriver_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get line() {
        const ret = wasm.__wbg_get_webdriver_line(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {number} arg0
     */
    set line(arg0) {
        wasm.__wbg_set_webdriver_line(this.__wbg_ptr, arg0);
    }
    /**
     * @returns {JSFlags}
     */
    get_flags() {
        const ret = wasm.webdriver_get_flags(this.__wbg_ptr);
        return JSFlags.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    get_int_21() {
        const ret = wasm.webdriver_get_int_21(this.__wbg_ptr);
        return ret;
    }
    /**
     * @param {number} start
     * @param {number} end
     * @returns {Uint8Array}
     */
    get_mem(start, end) {
        const ret = wasm.webdriver_get_mem(this.__wbg_ptr, start, end);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {JSReg}
     */
    get_reg() {
        const ret = wasm.webdriver_get_reg(this.__wbg_ptr);
        return JSReg.__wrap(ret);
    }
    /**
     * @returns {any}
     */
    get_state_snapshot() {
        const ret = wasm.webdriver_get_state_snapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {any}
     */
    int_10() {
        const ret = wasm.webdriver_int_10(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {InterpreterResult}
     */
    next() {
        const ret = wasm.webdriver_next(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return InterpreterResult.__wrap(ret[0]);
    }
    /**
     * @param {string} ip
     */
    set_int_21(ip) {
        const ptr0 = passStringToWasm0(ip, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.webdriver_set_int_21(this.__wbg_ptr, ptr0, len0);
    }
}
if (Symbol.dispose) WebDriver.prototype[Symbol.dispose] = WebDriver.prototype.free;

/**
 * @param {string} input
 * @returns {WebDriver}
 */
export function preprocess(input) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.preprocess(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return WebDriver.__wrap(ret[0]);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./emulator_8086_web_bg.js": import0,
    };
}

const InterpreterResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_interpreterresult_free(ptr, 1));
const JSFlagsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsflags_free(ptr, 1));
const JSRegFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_jsreg_free(ptr, 1));
const WebDriverFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_webdriver_free(ptr, 1));

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('emulator_8086_web_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
