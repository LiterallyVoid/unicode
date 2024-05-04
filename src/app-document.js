/**
 @template {string} S
 @typedef {
 S extends `input#${string}` ? HTMLInputElement :
 S extends `template#${string}` ? HTMLTemplateElement :
 S extends `progress#${string}` ? HTMLProgressElement :
 HTMLElement
 } Node
 */
/**
 @template {string} S
 @param {S} selector
 
 @returns {Node<S>}
 */
function query(selector) {
	/**
	 @type {Node<S> | null}
	 */
	const element = document.querySelector(selector);
	if (element == null) {
		throw new Error(`no element by selector: ${selector}`);
	}

	return element;
}

export const input = query("input#main-text-input");
export const visualization = query("#visualization");

export const table_load_bar = query("progress#table-load-bar");

export const templates = {
	table_header: query("template#table-header"),
	table_footer: query("template#table-footer"),
	grapheme: query("template#grapheme"),
	codepoint: query("template#codepoint"),
};


