/**
 @typedef Range
 @property {number} first - The first Unicode codepoint that this range contains
 @property {number} last - The last Unicode codepoint that this range contains, inclusive
 @property {"reserved" | "noncharacter" | "surrogate" | "character"} cls - This range's Unicode class
 @property {string} age - The Unicode version that introduced every character in this range
 @property {number} name_index - The index of a prefix tree node in this table's nametable.
 */

/**
@param {Uint8Array | number[]} array
@returns {[string, number]} The parsed ASCII high-bit-terminated string, and how long that string was in bytes.
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

console.assert(readVarAscii([0x41, 0x42, 0x43, 0xC4]).toString() == "ABCD,4");

/**
@param {Uint8Array | number[]} array
@returns {[number, number]} The parsed number, and how long that number was in bytes.
*/
function readVarInt(array) {
	let mult = 1;
	let number = 0;
	let length = 0;

	while (true) {
		number += (array[length] & 0x7F) * mult;
		mult *= 128;

		const last = (array[length] & 0x80) == 0;
		length += 1;

		if (last) break;
	}

	return [number, length];
}

console.assert(readVarInt([0x05]).toString() == "5,1");


export class Table {
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
		console.assert(this.as_u32[2] == 2);

		this.nametable = new Uint8Array(this.data, this.as_u32[3], this.as_u32[4]);
		const ages_bytes = new Uint8Array(this.data, this.as_u32[5], this.as_u32[6]);
		this.ranges = new Uint32Array(this.data, this.as_u32[7], this.as_u32[8] / 4);

		this.ages = [];
		for (let i = 0; i < ages_bytes.length;) {
			const [age, age_length] = readVarAscii(ages_bytes.subarray(i));
			this.ages.push(age);
			i += age_length;
		}
	}

	/**
	 @param {number} index - An index into this table's range list.
	 @returns {Range} A range, parsed from the range's bits
	 */
	rangeInfo(index) {
		const MASK_FIRST = 0x00FF_FFFF;

		const bits = this.ranges[index * 2];
		const name_index = this.ranges[index * 2 + 1];

		const first = bits & MASK_FIRST;

		let next_first = 0x10_FFFF + 1;
		if ((index * 2 + 2) < this.ranges.length) {
			next_first = this.ranges[index * 2 + 2] & MASK_FIRST;
		}
		const last = next_first - 1;

		const class_index = (bits >> 24) & 0x3;
		const cls = /** @type {const} */([
			"reserved",
			"noncharacter",
			"surrogate",
			"character",
		])[class_index];

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

	/**
	 Binary search for the range that contains Unicode codepoint `codepoint`.
	 A table's ranges cover the Unicode range (0x0..0x10_FFFF) are stored in order with no overlap, by construction.

	 @param {number} codepoint
	 @returns {Range}
	 */
	findRangeContainingCodepoint(codepoint) {
		// The range index we're looking for is in 0..<ranges_count
		// Each range is two 32-bit integers in the `Uint32Array` of `this.ranges`; divide by two to calculate range count from integer count.
		const ranges_count = this.ranges.length / 2;

		// (The names `lo` and `hi` were chosen so they're the same length in-code.)

		// The codepoint range we're looking for has an index somewhere in `0..<ranges_count`. We'll shrink this down to a single index (of a codepoint range) with a binary search.
		// We'll encode the search range as `lo..<hi`
		let lo = 0;
		let hi = ranges_count;

		while (lo != hi) {
			const mid = Math.floor((lo + hi) / 2);
			const mid_range = this.rangeInfo(mid);

			// `mid` splits the search range into three regions:
			//  * `lo..<mid`, all codepoint ranges before `mid`
			//  * `mid..<(mid + 1)`, the search range of exactly the codepoint range indexed `mid` and no other codepoint ranges.
			//  * `(mid + 1)..<hi`, all codepoint ranges after `mid`

			if (codepoint > mid_range.last) {
				// The range we're looking for is definitely in the third region,
				// so update our range to `(mid + 1)..<hi`, to cut off the other two regions.
				lo = mid + 1;
			} else if (codepoint < mid_range.first) {
				// The range we're looking for is definitely in the first region,
				// so update our range to `lo..<mid` (note: exclusive!)
				hi = mid;
			} else {
				// The codepoint range at `mid` contains the codepoint in question; return it!
				return mid_range;
			}
		}

		// `lo` and `hi` are equal, so it doesn't matter which one.
		return this.rangeInfo(lo);
	}

	/**
	@param {number} index
	@returns {string} A string read from the trie.
	*/
	readName(index) {
		if (index <= 0) return "";

		let cursor = index;

		const [prefix_offset, prefix_offset_length] =
			readVarInt(this.nametable.subarray(cursor));
		cursor += prefix_offset_length;

		const [suffix, suffix_length] =
			readVarAscii(this.nametable.subarray(cursor));
		cursor += suffix_length;

		// The verification here should be kept in sync with `check.py` from the `UCDNAMES` builder.

		// A suffix of length zero is pointless. Let's raise an error.
		if (suffix.length <= 0) {
			throw new Error("nametable has zero-length suffix");
		}

		// If prefix_offset is `0`, this name would have an infinite loop.
		// And if `prefix_offset > index`, this name would have a prefix of less than zero, which is simply not well-formed.
		if (prefix_offset < 1 || prefix_offset > index) {
			throw new Error();
		}

		const prefix = this.readName(index - prefix_offset);

		// Codepoint names shouldn't be too long. If they are, something's probably gone wrong.
		// Note that this check is *after* the recursion happens, on the way up, so it's pretty much pointless, as a long chain would overflow the stack before reaching here. But sanity checks are valuable anyway.
		if (prefix.length + suffix.length > 200) {
			throw new Error("name is too long!");
		}

		return prefix + suffix;
	}

	/**
	Get the name of Unicode codepoint `codepoint`.
	@param {number} codepoint
	@returns {string} The name of codepoint `codepoint`.
	*/
	codepointName(codepoint) {
		const range = this.findRangeContainingCodepoint(codepoint);
		return this.readName(range.name_index);
	}
}
