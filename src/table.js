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
	 @param {number} codepoint
	 @returns {Range}
	 */
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
