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

/**
@param {number[]} array
@returns {[string, number]} The parsed ASCII high-bit-terminated, and how long that string was in bytes.
*/
function readVarAscii(array) {
	let string = "";
	let length = 0;

	while (true) {
		string += String.fromCharCode(array[length] & 0x7F);

		const last = (array[length] & 0x80) == 0x80;
		length += 1;

		if (last) break;
	}

	return [string, length];
}

/**
@param {number[]} array
@returns {[number, number]} The parsed number, and how long that number was in bytes.
*/
function readVarInt(array) {
	let number = 0;
	let length = 0;

	while (true) {
		number *= 128;
		number += array[length] & 0x7F;

		const last = (array[length] & 0x80) == 0;
		length += 1;

		if (last) break;
	}

	return [number, length];
}

console.assert(readVarInt([0x05]).toString() == "5,1");

class Table {
	/**
	@param {ArrayBuffer} data
	*/
	constructor(data) {
		this.data = data;

		this.as_u8 = new Uint8Array(this.data);
		this.as_u32 = new Uint32Array(this.data);

		const magic = "UCDNAMES";
		console.assert(new TextDecoder().decode(this.as_u8.slice(0, 8)) == magic);

		// Verify version
		console.assert(this.as_u32[2] == 1);

		this.trie_bytes = new Uint8Array(this.data, this.as_u32[3], this.as_u32[4]);
		const ages_bytes = new Uint8Array(this.data, this.as_u32[5], this.as_u32[6]);
		this.ranges = new Uint32Array(this.data, this.as_u32[7], this.as_u32[8] / 4);

		this.ages = [];
		for (let i = 0; i < ages_bytes.length;) {
			const [age, age_length] = readVarAscii(ages_bytes.subarray(i));
			this.ages.push(age);
			i += age_length;
		}
	}

	rangeInfo(index) {
		const bits = this.ranges[index * 2];
		const name_index = this.ranges[index * 2 + 1];

		const first = bits & 0x00FF_FFFF;
		const next_first = (this.ranges[index * 2 + 2] ?? (0x10FFFF + 1)) & 0x00FF_FFFF;
		const last = next_first - 1;

		const class_index = (bits >> 24) & 0x3;
		const cls = [
			"reserved",
			"noncharacter",
			"surrogate",
			"character",
		][class_index];

		const age_index = (bits >> 26);
		const age = this.ages[age_index];

		return {
			first,
			last,
			cls,
			age,
			name_index,
		};
	}

	searchRanges(codepoint) {
		let lo = 0;
		let hi = this.ranges.length / 2;

		while (lo != hi) {
			const mid_index = Math.floor((lo + hi) / 2);
			const mid_range = this.rangeInfo(mid_index);

			if (codepoint > mid_range.last) {
				lo = mid_index + 1;
			} else if (codepoint < mid_range.first) {
				hi = mid_index;
			} else {
				return mid_range;
			}
		}

		return this.rangeInfo(lo);
	}

	/**
	@param {number} index
	@returns {string} A string read from the trie.
	*/
	readTrie(index) {
		if (index === 0) return "";

		const [prefix_offset, prefix_offset_length] = readVarInt(this.trie_bytes.subarray(index));
		const [suffix, _] = readVarAscii(this.trie_bytes.subarray(index + prefix_offset_length));

		console.assert(prefix_offset > 0);
		if (!(prefix_offset > 0)) throw new Error();

		return this.readTrie(index - prefix_offset) + suffix;
	}

	/**
	@param {number} codepoint
	@returns {string}
	*/
	codepointName(codepoint) {
		const range = this.searchRanges(codepoint);
		return this.readTrie(range.name_index);
	}
}

let table = null;

const input = document.querySelector("#main-text-input");
const visualization = document.querySelector("#visualization");

const templates = {
	table_header: document.querySelector("#table-header"),
	grapheme: document.querySelector("#grapheme"),
	codepoint: document.querySelector("#codepoint"),
};

/**
 @param {number} Unicode codepoint
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
	const cases = ["x", "£", "И", "€", "𐍈", "\u{1F3AE}"];

	for (const test_case of cases) {
		const codepoint = test_case.codePointAt(0);
		const ground_truth_bytes = new TextEncoder().encode(test_case);
		const bytes_under_test = codepointUtf8Units(codepoint);

		console.assert(ground_truth_bytes.length === bytes_under_test.length);

		for (let i = 0; i < bytes_under_test.length; i++) {
			console.assert(ground_truth_bytes[i] === bytes_under_test[i]);
		}
	}
}

/**
 @param {number} Unicode codepoint
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
	const cases = [
		["€", [0x20AC]],
		["𐐷", [0xD801, 0xDC37]],
	];

	for (const [test_case, ground_truth] of cases) {
		const codepoint = test_case.codePointAt(0);
		const under_test = codepointUtf16Units(codepoint);

		console.assert(under_test.length === ground_truth.length);

		for (let i = 0; i < under_test.length; i++) {
			console.assert(ground_truth[i] === under_test[i]);
		}
	}
}

/**
 @param {string} string
 @returns {Iterator<string>} A list of graphemes.
 */
function segmentGraphemes(string) {
	const segmenter = new Intl.Segmenter();

	return [...segmenter.segment(string)].map(segment => segment.segment);
}

/** Render a visualization of `string` into the document node `target`.
 @param {string} string
 @param {HTMLElement} target
 */
function render(string, target) {
	let grapheme_index = 0;
	let codepoint_index = 0;
	let utf_16_index = 0;
	let utf_8_index = 0;

	// Remove all elements from `target`.
	target.textContent = "";

	target.appendChild(templates.table_header.content.cloneNode(true));

	let character_index = 0;

	for (const grapheme of segmentGraphemes(string)) {
		const grapheme_element = templates.grapheme.content.cloneNode(true);

		if (grapheme_index++ % 2 == 1) {
			// The actual grapheme element is a child of the document fragment, not the root.
			grapheme_element.querySelector(".grapheme")
				.classList.add("grapheme--alternate");
		}

		grapheme_element.querySelector("[data-slot=text]").textContent = grapheme;

		for (const codepoint of grapheme) {
			const number = codepoint.codePointAt(0);
			const number_hex = number.toString(16).toUpperCase().padStart(4, "0");

			const codepoint_element = templates.codepoint.content.cloneNode(true);
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

			const delete_index = character_index;
			const delete_length = codepoint.length;
			codepoint_element.querySelector("[data-action=delete]").addEventListener("click", () => {
				input.value =
					input.value.substr(0, delete_index) +
					input.value.substr(delete_index + delete_length);

				userDidChangeInput();
			});

			character_index += codepoint.length;

			grapheme_element.querySelector("[data-slot=codepoints]").appendChild(codepoint_element);
		}

		target.appendChild(grapheme_element);
	}
}

function renderAll() {
	render(input.value, visualization);
}

let ignore_hash_change_if_equal_to = null;
// NOT called when the input's changed by the hash changing.
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

function updateInputFromWindowHash() {
	if (!window.location.hash || window.location.hash.length < 1) {
		return;
	}

	if (window.location.hash === ignore_hash_change_if_equal_to) {
		ignore_hash_change_if_equal_to = null;
		return;
	}

	// Setting `input.value` doesn't trigger the input's `input` event, right?
	input.value = decodeURIComponent(window.location.hash.substring(1));
	renderAll();

}

window.addEventListener("hashchange", (_) => {
	updateInputFromWindowHash();
});
updateInputFromWindowHash();
