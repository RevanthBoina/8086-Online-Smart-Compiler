use super::driver::new_webdriver;
use super::driver::WebDriver;
use super::error_helper::get_err_pos;
use lib8086::DataParser;
use lib8086::InterpreterContext;
use lib8086::LabelType;
use lib8086::LexerHelper;
use lib8086::VM;
use lib8086::{Preprocessor, PreprocessorContext, PreprocessorOutput};
use lalrpop_util::ParseError;
use std::mem::drop;

use regex::Regex;
use wasm_bindgen::prelude::*;

/// Accept Intel-style hex literals such as `0005h`, `0FFh` or `21h` by
/// rewriting them into the `0x…` form understood by the upstream grammar
/// (the interpreter only accepts `0x…`, `0b…` and decimal numbers).
///
/// Safety rules:
/// * only runs that **start with a digit** are considered, so identifiers such
///   as `AH`, `BH` or `each` can never be rewritten;
/// * `0x…` / `0b…` tokens are copied verbatim as one unit;
/// * the character after `h` must not be alphanumeric, so `10hx` stays intact;
/// * no newlines are added or removed, so every reported line number still
///   matches the source the user is editing.
fn normalize_hex_literals(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        // Already-valid 0x… token: copy it as one unit.
        if c == b'0' && i + 1 < bytes.len() && matches!(bytes[i + 1], b'x' | b'X') {
            let mut j = i + 2;
            while j < bytes.len() && bytes[j].is_ascii_hexdigit() {
                j += 1;
            }
            out.push_str(&input[i..j]);
            i = j;
            continue;
        }
        // A real 0b… token (only 0/1 digits, proper terminator) is copied
        // verbatim. Anything else starting like `0B…` (e.g. the hex literal
        // `0BCh`) falls through so the digit-run branch rewrites it to 0x0BC.
        if c == b'0' && i + 1 < bytes.len() && matches!(bytes[i + 1], b'b' | b'B') {
            let mut j = i + 2;
            while j < bytes.len() && matches!(bytes[j], b'0' | b'1') {
                j += 1;
            }
            let is_binary = j > i + 2 && (j == bytes.len() || !bytes[j].is_ascii_alphanumeric());
            if is_binary {
                out.push_str(&input[i..j]);
                i = j;
                continue;
            }
        }
        // Numeric run (always starts with a digit => never an identifier).
        if c.is_ascii_digit() {
            let start = i;
            let mut j = i;
            while j < bytes.len() && bytes[j].is_ascii_hexdigit() {
                j += 1;
            }
            if j < bytes.len() && (bytes[j] == b'h' || bytes[j] == b'H') {
                let after = j + 1;
                if after == bytes.len() || !bytes[after].is_ascii_alphanumeric() {
                    out.push_str("0x");
                    out.push_str(&input[start..j]);
                    i = after;
                    continue;
                }
            }
            out.push_str(&input[start..j]);
            i = j;
            continue;
        }
        // Preserve any non-ASCII UTF-8 sequence untouched.
        if c >= 0x80 {
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j] & 0xC0) == 0x80 {
                j += 1;
            }
            out.push_str(&input[i..j]);
            i = j;
            continue;
        }
        out.push(c as char);
        i += 1;
    }
    out
}

#[wasm_bindgen]
pub fn preprocess(input: &str) -> Result<WebDriver, JsValue> {
    let uncommented;
    {
        let r = Regex::new(r";.*\n?").unwrap();
        uncommented = normalize_hex_literals(&r.replace_all(input, "\n"));
        drop(r);
    }
    // create parameters
    let mut ctx = PreprocessorContext::default();
    let mut out = PreprocessorOutput::default();
    // create preprocessor
    let helper = LexerHelper::new(&uncommented);
    {
        let preprocessor = Box::new(Preprocessor::new());
        // parse
        match preprocessor.parse(&mut ctx, &mut out, &uncommented) {
            Err(e) => {
                // if error type is UnrecognizedToken,
                // it can be actual unknown token, or the piggybacked custom error
                if let ParseError::UnrecognizedToken {
                    token: (ref start, ref token, _),
                    ref expected,
                } = e
                {
                    // get error position
                    let (line, lstart, lend) = get_err_pos(&helper, *start);
                    let pos_str = format!(
                        "{}:{} : {}",
                        line,
                        start - lstart,
                        &uncommented[lstart..lend]
                    );

                    if token.1 == "" {
                        // error is custom, piggybacked on UnrecognizedToken type
                        return Err(JsValue::from(format!(
                            "Syntax Error at {} :\n{}",
                            pos_str, expected[0]
                        )));
                    } else {
                        // actual unrecognized token
                        return Err(JsValue::from(format!(
                            "Syntax Error at line {} :\nUnexpected Token : {}",
                            pos_str, token
                        )));
                    }
                } else {
                    // some other type of error
                    return Err(JsValue::from(format!("Syntax Error :\n{}", e)));
                };
            }
            Ok(_) => {}
        }
        drop(preprocessor);
    }
    let PreprocessorContext {
        macro_nesting_counter: _,
        data_counter: _,
        label_map: lmap,
        macro_map: _,
        mapper,
        fn_map,
        undefined_labels,
    } = ctx;

    for (pos, l) in undefined_labels.iter() {
        match lmap.get(l) {
            Some(_) => {}
            None => {
                let (line, start, end) = get_err_pos(&helper, *pos);
                return Err(JsValue::from(format!(
                    "Label {} used but not defined at line {} :{} : {}",
                    l,
                    line,
                    end - pos,
                    &uncommented[start..end]
                )));
            }
        }
    }

    let idx; // for iterating through code

    match lmap.get("start") {
        Some(l) => match l.get_type() {
            LabelType::DATA => {
                return Err(JsValue::from(
                    "Error : necessary label 'start' is not found in code",
                ));
            }
            LabelType::CODE => idx = l.map,
        },
        None => {
            return Err(JsValue::from(
                "Error : necessary label 'start' is not found in code",
            ));
        }
    }
    let source_map = mapper.get_source_map();
    let ictx = InterpreterContext {
        fn_map: fn_map,
        label_map: lmap,
        call_stack: Vec::new(),
    };
    // this is for the data counter required by data parser
    let mut ctr = 0;
    out.code.push("hlt".to_owned());
    let mut vm = VM::new();
    {
        let data_parser = Box::new(DataParser::new());
        for i in out.data.iter() {
            match data_parser.parse(&mut vm, &mut ctr, i) {
                Ok(_) => {}
                Err(e) => {
                    // should not reach here, as all error of syntax should have checked in preprocessor
                    return Err(JsValue::from(format!(
                        "Internal Error : Should not have reached here in data parser\nError : {}",
                        e
                    )));
                }
            }
        }
        drop(data_parser);
    }
    let t = source_map.get(&idx).unwrap();
    let (mapped_line, _, _) = get_err_pos(&helper, *t);
    let wd = new_webdriver(
        idx,
        mapped_line,
        vm,
        uncommented,
        source_map,
        helper,
        out,
        ictx,
    );
    return Ok(wd);
}
