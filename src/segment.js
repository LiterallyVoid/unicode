
/**
 @param {number} codepoint - Unicode codepoint
 @returns {number[]} UTF-8 bytes
 */
export function codepointUtf8Units(codepoint) {
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
export function codepointUtf16Units(codepoint) {
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
export function segmentGraphemes(string) {
	const segmenter = new Intl.Segmenter();

	return [...segmenter.segment(string)].map(segment => segment.segment);
}

