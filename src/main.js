import { Table } from "./table.js";
import { input, visualization, templates } from "./app-document.js";

/**
  @param {string} url
  @param {(progress: number) => void} progress_callback
  */
async function loadArrayBuffer(url, progress_callback) {
	const req = new XMLHttpRequest();
	req.responseType = "arraybuffer";
	req.addEventListener("progress", (ev) => {
		progress_callback(ev.loaded / ev.total);
	});

	const promise = new Promise((resolve, reject) => {
		req.addEventListener("load", (_) => {
			progress_callback(1);
			resolve(req.response);
		})

		req.addEventListener("error", (_) => {
			reject(new Error(`failed to load ${url}: ${req.status} ${req.statusText}`));
		})

		req.addEventListener("abort", (_) => {
			reject(new Error(`failed to load ${url}: abort`));
		})
	});

	req.open("GET", url);
	req.send();

	return promise;
}

/** @type {Table | null} */
let table = null;

/**
 @param {number} codepoint - Unicode codepoint
 @returns {number[]} UTF-8 bytes
 */
function codepointUtf8Units(codepoint) {
	if (codepoint <= 0x7F) {
		return [codepoint];
	}

	if (codepoint < 0x7FF) {
		return [
			0xC0 | (codepoint >> 6),
			0x80 | (codepoint & 0x3F),
		];
	}

	if (codepoint < 0xFFFF) {
		return [
			0xE0 | (codepoint >> 12),
			0x80 | ((codepoint >> 6) & 0x3F),
			0x80 | (codepoint & 0x3F),
		];
	}

	return [
		0xF0 | (codepoint >> 18),
		0x80 | ((codepoint >> 12) & 0x3F),
		0x80 | ((codepoint >> 6) & 0x3F),
		0x80 | (codepoint & 0x3F),
	];
}

{
	const cases = /** @type {const} */(["x", "£", "И", "€", "𐍈", "\u{1F3AE}"]);

	for (const test_case of cases) {
		const codepoint = test_case.codePointAt(0) ?? -1;
		const ground_truth_bytes = new TextEncoder().encode(test_case);
		const bytes_under_test = codepointUtf8Units(codepoint);

		console.assert(ground_truth_bytes.length === bytes_under_test.length);

		for (let i = 0; i < bytes_under_test.length; i++) {
			console.assert(ground_truth_bytes[i] === bytes_under_test[i]);
		}
	}
}

/**
 @param {number} codepoint - Unicode codepoint
 @returns {number[]} UTF-16 code words
 */
function codepointUtf16Units(codepoint) {
	if (codepoint <= 0xFFFF) {
		return [codepoint];
	}

	const codepoint_offset = codepoint - 0x1_0000;
	return [
		0xD800 + ((codepoint_offset >> 10) & 0x3FF),
		0xDC00 + (codepoint_offset & 0x3FF),
	];
}

{
	const cases = /** @type {const} */([
		["€", [0x20AC]],
		["𐐷", [0xD801, 0xDC37]],
	]);

	for (const [test_case, ground_truth] of cases) {
		const codepoint = test_case.codePointAt(0) ?? -1;
		const under_test = codepointUtf16Units(codepoint);

		console.assert(under_test.length === ground_truth.length);

		for (let i = 0; i < under_test.length; i++) {
			console.assert(ground_truth[i] === under_test[i]);
		}
	}
}

/**
 @param {string} string
 @returns {Iterable<string>} A list of graphemes.
 */
function segmentGraphemes(string) {
	const segmenter = new Intl.Segmenter();

	return [...segmenter.segment(string)].map(segment => segment.segment);
}

/** Render a visualization of `string` into the document node `target`.
 @param {{
	  value: string,
	  target: HTMLElement,
	  onDeleteRange: (start_index: number, end_index: number) => void,
 }} props
 */
function render({ value, target, onDeleteRange }) {
	let grapheme_index = 0;
	let codepoint_index = 0;
	let utf_16_index = 0;
	let utf_8_index = 0;

	// Remove all elements from `target`.
	target.textContent = "";

	target.appendChild(templates.table_header.content.cloneNode(true));

	let character_index = 0;

	for (const grapheme of segmentGraphemes(value)) {
		const grapheme_element = templates.grapheme.content.cloneNode(true);
		if (!(grapheme_element instanceof DocumentFragment)) throw new Error();

		if (grapheme_index++ % 2 == 1) {
			// The actual grapheme element is a child of the document fragment, not the root.
			grapheme_element.querySelector(".grapheme")
				.classList.add("grapheme--alternate");
		}

		grapheme_element.querySelector("[data-slot=text]").textContent = grapheme;

		for (const codepoint of grapheme) {
			const number = codepoint.codePointAt(0) ?? -1;
			const number_hex = number.toString(16).toUpperCase().padStart(4, "0");

			const codepoint_element = templates.codepoint.content.cloneNode(true);
			if (!(codepoint_element instanceof DocumentFragment)) throw new Error();

			if (codepoint_index++ % 2 == 1) {
				codepoint_element.querySelector(".codepoint")
					.classList.add("codepoint--alternate");
			}


			codepoint_element.querySelector("[data-slot=number]").textContent = number_hex;
			codepoint_element.querySelector("[data-slot=name]").textContent = table?.codepointName?.(number) ?? "(table not loaded)";

			for (const unit of codepointUtf16Units(number)) {
				const container = document.createElement("div");
				const unit_element = document.createElement("span")
				container.appendChild(unit_element);

				if (utf_16_index++ % 2 == 1) {
					container.classList.add("code-unit--alternate");
				}

				if (unit >= 0xD800 && unit <= 0xDBFF) {
					container.classList.add("code-unit--utf16-high-surrogate");
				} else if (unit >= 0xDC00 && unit < 0xDFFF) {
					container.classList.add("code-unit--utf16-low-surrogate");
				}

				unit_element.textContent = unit.toString(16).toUpperCase().padStart(4, "0");

				codepoint_element.querySelector("[data-slot=utf-16]").appendChild(container);
			}

			for (const unit of codepointUtf8Units(number)) {
				const container = document.createElement("div");
				const unit_element = document.createElement("span")
				container.appendChild(unit_element);

				if (utf_8_index++ % 2 == 1) {
					container.classList.add("code-unit--alternate");
				}

				if (unit >= 0x80 && unit <= 0xBF) {
					container.classList.add("code-unit--utf8-continuation");
				} else if (unit >= 0xC0 && unit <= 0xDF) {
					container.classList.add("code-unit--utf8-start-mb2");
				} else if (unit >= 0xE0 && unit <= 0xEF) {
					container.classList.add("code-unit--utf8-start-mb3");
				} else if (unit >= 0xF0 && unit <= 0xF7) {
					container.classList.add("code-unit--utf8-start-mb4");
				}

				unit_element.textContent = unit.toString(16).toUpperCase().padStart(2, "0");

				codepoint_element.querySelector("[data-slot=utf-8]").appendChild(container);
			}

			// `character_index` isn't a loop variable, so there isn't a new capture for every loop iteration. Make a new variable so the event listener has a unique capture for each iteration.
			const delete_index = character_index;
			const delete_length = codepoint.length;
			codepoint_element.querySelector("[data-action=delete]").addEventListener("click", () => {
				onDeleteRange(
					delete_index,
					delete_index + delete_length,
				);
			});

			character_index += codepoint.length;

			grapheme_element.querySelector("[data-slot=codepoints]").appendChild(codepoint_element);
		}

		target.appendChild(grapheme_element);
	}

	const footer = templates.table_footer.content.cloneNode(true);

	footer.querySelector("[data-slot=utf-8-bytes]").textContent =
		utf_8_index.toLocaleString();
	footer.querySelector("[data-slot=utf-16-units]").textContent =
		utf_16_index.toLocaleString();
	footer.querySelector("[data-slot=codepoints]").textContent =
		codepoint_index.toLocaleString();
	footer.querySelector("[data-slot=graphemes]").textContent =
		grapheme_index.toLocaleString();

	target.appendChild(footer);
}

function renderAll() {
	render({
		value: input.value,
		target: visualization,

		onDeleteRange(start, end) {
			input.value =
				input.value.substring(0, start) +
				input.value.substring(end);

			userDidChangeInput();
		},
	});
}

/** @type {string | null} */
let ignore_hash_change_if_equal_to = null;

function windowHashDidChange() {
	if (!window.location.hash || window.location.hash.length < 1) {
		return;
	}

	if (window.location.hash === ignore_hash_change_if_equal_to) {
		ignore_hash_change_if_equal_to = null;
		return;
	}

	input.value = decodeURIComponent(window.location.hash.substring(1));
	renderAll();

}

window.addEventListener("hashchange", (_) => {
	windowHashDidChange();
});

windowHashDidChange();

function userDidChangeInput() {
	window.location.hash = "#" + encodeURIComponent(input.value);
	ignore_hash_change_if_equal_to = window.location.hash;
	renderAll();
}

input.addEventListener("input", () => {
	userDidChangeInput();
});

renderAll();

loadArrayBuffer("data/ucd.bin", progress => {
	// console.log(progress);
})
	.then((buffer) => {
		table = new Table(buffer);
		renderAll();
	});

