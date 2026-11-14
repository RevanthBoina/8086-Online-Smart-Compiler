// wasm entry point: source -> tokens -> statements -> validated Program ->
// WebDriver. Diagnostics always carry "at line N" so the editor can place
// error annotations.

use super::driver::WebDriver;
use crate::frontend::lexer::lex;
use crate::frontend::parser::Parser;
use crate::frontend::sema::analyze;
use wasm_bindgen::prelude::*;

fn line_snippet(lines: &[String], line: usize) -> String {
    lines
        .get(line.saturating_sub(1))
        .map(|l| {
            let no_comment = match l.find(';') {
                Some(i) => l[..i].to_string(),
                None => l.clone(),
            };
            no_comment.trim().to_string()
        })
        .unwrap_or_default()
}

fn fmt_err(kind: &str, lines: &[String], line: usize, col: usize, msg: &str) -> String {
    format!(
        "{} at line {}:{} : {} : {}",
        kind,
        line,
        col,
        line_snippet(lines, line),
        msg
    )
}

#[wasm_bindgen]
pub fn preprocess(input: &str) -> Result<WebDriver, JsValue> {
    let lines: Vec<String> = input.lines().map(|l| l.to_string()).collect();

    let toks = lex(input).map_err(|e| {
        JsValue::from(fmt_err("Syntax Error", &lines, e.line, e.col, &e.msg))
    })?;

    let stmts = Parser::new(toks, lines.clone()).parse().map_err(|e| {
        JsValue::from(fmt_err("Syntax Error", &lines, e.line, e.col, &e.msg))
    })?;

    let prog = analyze(stmts, lines.clone()).map_err(|e| {
        JsValue::from(fmt_err("Error", &lines, e.line, e.col, &e.msg))
    })?;

    Ok(WebDriver::new(prog))
}
