"use strict";
// Minimal DOM double for running a page's inline controller script in node:vm.
// It records element state (text, disabled, hidden, children) so tests can
// assert real behaviour rather than matching source text.
const fs = require("node:fs");
const vm = require("node:vm");

function createElement(tag, id) {
  const listeners = {};
  const element = {
    tagName: String(tag || "div").toUpperCase(), id: id || "",
    textContent: "", innerHTML: "", value: "", disabled: false, hidden: false,
    min: "", max: "", title: "", className: "", children: [], dataset: {},
    style: {}, attributes: {}, listeners,
    classList: {
      _set: new Set(),
      add(name) { this._set.add(name); }, remove(name) { this._set.delete(name); },
      toggle(name, force) { const on = force === undefined ? !this._set.has(name) : !!force; if (on) this._set.add(name); else this._set.delete(name); return on; },
      contains(name) { return this._set.has(name); }
    },
    addEventListener(type, callback) { (listeners[type] = listeners[type] || []).push(callback); },
    removeEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter(item => item !== child); return child; },
    replaceChildren(...nodes) { this.children = nodes; this.textContent = ""; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name]; },
    select() {}, focus() {},
    fire(type, event) { return Promise.all((listeners[type] || []).map(callback => callback(event || {}))); }
  };
  return element;
}

function createDocument(initialValues) {
  const elements = new Map();
  const values = initialValues || {};
  const document = {
    readyState: "complete",
    elements,
    getElementById(id) {
      if (!elements.has(id)) {
        const element = createElement("div", id);
        if (values[id] !== undefined) element.value = values[id];
        elements.set(id, element);
      }
      return elements.get(id);
    },
    createElement(tag) { return createElement(tag); },
    querySelectorAll() { return []; },
    addEventListener() {},
    body: createElement("body"),
    execCommand() { return true; }
  };
  return document;
}

function inlineScripts(path) {
  const page = fs.readFileSync(path, "utf8");
  return [...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1].trim()).filter(Boolean);
}

function runPage(path, globals, options) {
  const document = createDocument(options && options.values);
  const context = Object.assign({
    document, console, Date, Math, Number, String, Object, Array, JSON, Promise, Error, TypeError, RangeError,
    Intl, URL, URLSearchParams, setTimeout, clearTimeout, queueMicrotask, isFinite,
    AbortController, navigator: {}, location: { search: "" }
  }, globals || {});
  context.window = context;
  context.globalThis = context;
  const scripts = inlineScripts(path);
  for (const script of scripts) vm.runInNewContext(script, context, { filename: path });
  return { document, context, $: id => document.getElementById(id) };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

module.exports = { createElement, createDocument, runPage, flush, deferred };
