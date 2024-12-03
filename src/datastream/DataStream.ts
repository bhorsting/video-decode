import {TextEncoder, TextDecoder} from "text-encoding";

export type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type StructReadFn = (ds: DataStream, struct: object) => any;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type LenFn = (struct: object, ds: DataStream, def: StructRead) => any;

// https://github.com/Microsoft/TypeScript/issues/3496#issuecomment-128553540
/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type StructRead =
    | string
    | StructReadFn
    | {get: StructReadFn}
    | ["[]", string, string | LenFn]
    | StructReadArray;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
// tslint:disable-next-line no-empty-interface
export interface StructReadArray extends Array<StructRead> {}

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type StructWriteFn = (
    ds: DataStream,
    field: string,
    struct: object
) => void;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
export type StructWrite =
    | string
    | StructWriteFn
    | {set: StructWriteFn}
    | StructWriteArray;

/** @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct */
// tslint:disable-next-line no-empty-interface
export interface StructWriteArray extends Array<StructWrite> {}

/**
 * Type endsWith '*' mean array.
 * Type endsWith '+' mean array | utf8 string with length encoded as Uint16 & write/read before the actual array | utf8 string.
 */
// prettier-ignore
export type Type =
    "Int8" | "Int16" | "Int32" | "Uint8" | "Uint16" | "Uint32" | "Float32" | "Float64" |
    "Int8*" | "Int16*" | "Int32*" | "Uint8*" | "Uint16*" | "Uint32*" | "Float32*" | "Float64*" |
    "Utf8WithLen";

// tslint:disable-next-line no-empty-interface
export interface TypeArr extends Array<Type | TypeArr> {}

/** [0] is object field's name to read from or write into.
 *  [1] is its type definition
 *  examples:
 *  ["num", "Int16"]
 *  ["greet", "Utf8+"]
 *  ["obj", [
 *      ["num", "Int8"],
 *      ["len", "Uint16"],
 *      ["greet", "Utf8"]]
 *  ]
 */
export type TypeDef1 = [string, Type | TypeDef];
// tslint:disable-next-line no-empty-interface
export interface TypeDef extends Array<TypeDef1> {}

/**
 * DataStream reads scalars, arrays and structs of data from an ArrayBuffer.
 * It's like a file-like DataView on steroids.
 *
 * @param {ArrayBuffer} arrayBuffer ArrayBuffer to read from.
 * @param {?Number} byteOffset Offset from arrayBuffer beginning for the DataStream.
 * @param {?Boolean} endianness DataStream.BIG_ENDIAN or DataStream.LITTLE_ENDIAN (the default).
 */
export default class DataStream {
    private _byteOffset: number;
    position = 0;
    private _buffer: ArrayBuffer;
    private _dataView: DataView;

    constructor(
        arrayBuffer?:
            | ArrayBuffer
            | {buffer: ArrayBuffer; byteOffset: number; byteLength: number},
        byteOffset?: number,
        public endianness: boolean = DataStream.LITTLE_ENDIAN
    ) {
        this._byteOffset = byteOffset || 0;
        if (arrayBuffer instanceof ArrayBuffer) {
            this.buffer = arrayBuffer;
        } else if (typeof arrayBuffer === "object") {
            this.dataView = arrayBuffer as any;
            if (byteOffset) {
                this._byteOffset += byteOffset;
            }
        } else {
            this.buffer = new ArrayBuffer(arrayBuffer || 1);
        }
    }

    /**
     * Big-endian const to use as default endianness.
     * @type {boolean}
     */
    static readonly BIG_ENDIAN = false;

    /**
     * Little-endian const to use as default endianness.
     * @type {boolean}
     */
    static readonly LITTLE_ENDIAN = true;

    /**
     * Whether to extend DataStream buffer when trying to write beyond its size.
     * If set, the buffer is reallocated to twice its current size until the
     * requested write fits the buffer.
     * @type {boolean}
     */
    private _dynamicSize = true;
    get dynamicSize(): boolean {
        return this._dynamicSize;
    }

    set dynamicSize(v: boolean) {
        if (!v) {
            this._trimAlloc();
        }
        this._dynamicSize = v;
    }

    /**
     * Virtual byte length of the DataStream backing buffer.
     * Updated to be max of original buffer size and last written size.
     * If dynamicSize is false is set to buffer size.
     * @type {number}
     */
    private _byteLength = 0;

    /**
     * Returns the byte length of the DataStream object.
     * @type {number}
     */
    get byteLength(): number {
        return this._byteLength - this._byteOffset;
    }

    /**
     * Set/get the backing ArrayBuffer of the DataStream object.
     * The setter updates the DataView to point to the new buffer.
     * @type {Object}
     */
    get buffer(): ArrayBuffer {
        this._trimAlloc();
        return this._buffer;
    }

    set buffer(v: ArrayBuffer) {
        this._buffer = v;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._buffer.byteLength;
    }

    /**
     * Set/get the byteOffset of the DataStream object.
     * The setter updates the DataView to point to the new byteOffset.
     * @type {number}
     */
    get byteOffset(): number {
        return this._byteOffset;
    }

    set byteOffset(v: number) {
        this._byteOffset = v;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._buffer.byteLength;
    }

    /**
     * Set/get the backing DataView of the DataStream object.
     * The setter updates the buffer and byteOffset to point to the DataView values.
     * @type get: DataView, set: {buffer: ArrayBuffer, byteOffset: number, byteLength: number}
     */
    get dataView(): DataView {
        return this._dataView;
    }

    set dataView(v: DataView) {
        this._byteOffset = v.byteOffset;
        this._buffer = v.buffer;
        this._dataView = new DataView(this._buffer, this._byteOffset);
        this._byteLength = this._byteOffset + v.byteLength;
    }

    bigEndian(): DataStream {
        this.endianness = DataStream.BIG_ENDIAN;
        return this;
    }

    public getPosition(): number {
        return this.position;
    }

    /**
     * Internal function to resize the DataStream buffer when required.
     * @param {number} extra Number of bytes to add to the buffer allocation.
     * @return {null}
     */
    private _realloc(extra: number) {
        if (!this._dynamicSize) {
            return;
        }
        const req = this._byteOffset + this.position + extra;
        let blen = this._buffer.byteLength;
        if (req <= blen) {
            if (req > this._byteLength) {
                this._byteLength = req;
            }
            return;
        }
        if (blen < 1) {
            blen = 1;
        }
        while (req > blen) {
            blen *= 2;
        }
        const buf = new ArrayBuffer(blen);
        const src = new Uint8Array(this._buffer);
        const dst = new Uint8Array(buf, 0, src.length);
        dst.set(src);
        this.buffer = buf;
        this._byteLength = req;
    }

    /**
     * Internal function to trim the DataStream buffer when required.
     * Used for stripping out the extra bytes from the backing buffer when
     * the virtual byteLength is smaller than the buffer byteLength (happens after
     * growing the buffer with writes and not filling the extra space completely).
     * @return {null}
     */
    private _trimAlloc(): void {
        if (this._byteLength === this._buffer.byteLength) {
            return;
        }
        const buf = new ArrayBuffer(this._byteLength);
        const dst = new Uint8Array(buf);
        const src = new Uint8Array(this._buffer, 0, dst.length);
        dst.set(src);
        this.buffer = buf;
    }

    /**
     * Sets the DataStream read/write position to given position.
     * Clamps between 0 and DataStream length.
     * @param {number} pos Position to seek to.
     * @return {null}
     */
    seek(pos) {
        const npos = Math.max(0, Math.min(this.byteLength, pos));
        this.position = isNaN(npos) || !isFinite(npos) ? 0 : npos;
    }

    /**
     * Returns true if the DataStream seek pointer is at the end of buffer and
     * there's no more data to read.
     * @return {boolean} True if the seek pointer is at the end of the buffer.
     */
    isEof() {
        return this.position >= this.byteLength;
    }

    /**
     * Maps an Int32Array into the DataStream buffer, swizzling it to native
     * endianness in-place. The current offset from the start of the buffer needs to
     * be a multiple of element size, just like with typed array views.
     *
     * Nice for quickly reading in data. Warning: potentially modifies the buffer
     * contents.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} Int32Array to the DataStream backing buffer.
     */
    mapInt32Array(length: number, e?: boolean): Int32Array {
        this._realloc(length * 4);
        const arr = new Int32Array(
            this._buffer,
            this.byteOffset + this.position,
            length
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += length * 4;
        return arr;
    }

    /**
     * Maps an Int16Array into the DataStream buffer, swizzling it to native
     * endianness in-place. The current offset from the start of the buffer needs to
     * be a multiple of element size, just like with typed array views.
     *
     * Nice for quickly reading in data. Warning: potentially modifies the buffer
     * contents.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} Int16Array to the DataStream backing buffer.
     */
    mapInt16Array(length: number, e?: boolean): Int16Array {
        this._realloc(length * 2);
        const arr = new Int16Array(
            this._buffer,
            this.byteOffset + this.position,
            length
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += length * 2;
        return arr;
    }

    /**
     * Maps an Int8Array into the DataStream buffer.
     *
     * Nice for quickly reading in data.
     *
     * @param {number} length Number of elements to map.
     * @return {Object} Int8Array to the DataStream backing buffer.
     */
    mapInt8Array(length: number): Int8Array {
        this._realloc(length);
        const arr = new Int8Array(
            this._buffer,
            this.byteOffset + this.position,
            length
        );
        this.position += length;
        return arr;
    }

    /**
     * Maps a Uint32Array into the DataStream buffer, swizzling it to native
     * endianness in-place. The current offset from the start of the buffer needs to
     * be a multiple of element size, just like with typed array views.*
     * Nice for quickly reading in data. Warning: potentially modifies the buffer
     * contents.*
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} Uint32Array to the DataStream backing buffer.
     */
    mapUint32Array(length: number, e?: boolean): Uint32Array {
        this._realloc(length * 4);
        const arr = new Uint32Array(
            this._buffer,
            this.byteOffset + this.position,
            length
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += length * 4;
        return arr;
    }

    /**
     * Maps a Uint16Array into the DataStream buffer, swizzling it to native
     * endianness in-place. The current offset from the start of the buffer needs to
     * be a multiple of element size, just like with typed array views.
     *
     * Nice for quickly reading in data. Warning: potentially modifies the buffer
     * contents.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} Uint16Array to the DataStream backing buffer.
     */
    mapUint16Array(length: number, e?: boolean): Uint16Array {
        this._realloc(length * 2);
        const arr = new Uint16Array(
            this._buffer,
            this.byteOffset + this.position,
            length
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += length * 2;
        return arr;
    }

    /**
     * Maps a Uint8Array into the DataStream buffer.
     *
     * Nice for quickly reading in data.
     *
     * @param {number} length Number of elements to map.
     * @return {Object} Uint8Array to the DataStream backing buffer.
     */
    mapUint8Array(length: number): Uint8Array {
        this._realloc(length);
        const arr = new Uint8Array(
            this._buffer,
            this.byteOffset + this.position,
            length
        );
        this.position += length;
        return arr;
    }

    /**
     * Maps a Float64Array into the DataStream buffer, swizzling it to native
     * endianness in-place. The current offset from the start of the buffer needs to
     * be a multiple of element size, just like with typed array views.
     *
     * Nice for quickly reading in data. Warning: potentially modifies the buffer
     * contents.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} Float64Array to the DataStream backing buffer.
     */
    mapFloat64Array(length: number, e?: boolean): Float64Array {
        this._realloc(length * 8);
        const arr = new Float64Array(
            this._buffer,
            this.byteOffset + this.position,
            length
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += length * 8;
        return arr;
    }

    /**
     * Maps a Float32Array into the DataStream buffer, swizzling it to native
     * endianness in-place. The current offset from the start of the buffer needs to
     * be a multiple of element size, just like with typed array views.
     *
     * Nice for quickly reading in data. Warning: potentially modifies the buffer
     * contents.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} Float32Array to the DataStream backing buffer.
     */
    mapFloat32Array(length: number, e?: boolean): Float32Array {
        this._realloc(length * 4);
        const arr = new Float32Array(
            this._buffer,
            this.byteOffset + this.position,
            length
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += length * 4;
        return arr;
    }

    /**
     * Reads an Int32Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Int32Array.
     */
    readInt32Array(length: number, e?: boolean): Int32Array {
        length = length == null ? this.byteLength - this.position / 4 : length;
        const arr = new Int32Array(length);
        DataStream.memcpy(
            arr.buffer,
            0,
            this.buffer,
            this.byteOffset + this.position,
            length * arr.BYTES_PER_ELEMENT
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads an Int16Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Int16Array.
     */
    readInt16Array(length: number, e?: boolean): Int16Array {
        length = length == null ? this.byteLength - this.position / 2 : length;
        const arr = new Int16Array(length);
        DataStream.memcpy(
            arr.buffer,
            0,
            this.buffer,
            this.byteOffset + this.position,
            length * arr.BYTES_PER_ELEMENT
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads an Int8Array of desired length from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @return {Object} The read Int8Array.
     */
    readInt8Array(length: number): Int8Array {
        length = length == null ? this.byteLength - this.position : length;
        const arr = new Int8Array(length);
        DataStream.memcpy(
            arr.buffer,
            0,
            this.buffer,
            this.byteOffset + this.position,
            length * arr.BYTES_PER_ELEMENT
        );
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Uint32Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Uint32Array.
     */
    readUint32Array(length: number, e?: boolean): Uint32Array {
        length = length == null ? this.byteLength - this.position / 4 : length;
        const arr = new Uint32Array(length);
        DataStream.memcpy(
            arr.buffer,
            0,
            this.buffer,
            this.byteOffset + this.position,
            length * arr.BYTES_PER_ELEMENT
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Uint16Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Uint16Array.
     */
    readUint16Array(length: number, e?: boolean): Uint16Array {
        length = length == null ? this.byteLength - this.position / 2 : length;
        const arr = new Uint16Array(length);
        DataStream.memcpy(
            arr.buffer,
            0,
            this.buffer,
            this.byteOffset + this.position,
            length * arr.BYTES_PER_ELEMENT
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Uint8Array of desired length from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @return {Object} The read Uint8Array.
     */
    readUint8Array(length: number): Uint8Array {
        length = length == null ? this.byteLength - this.position : length;
        const arr = new Uint8Array(length);
        DataStream.memcpy(
            arr.buffer,
            0,
            this.buffer,
            this.byteOffset + this.position,
            length * arr.BYTES_PER_ELEMENT
        );
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Float64Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Float64Array.
     */
    readFloat64Array(length: number, e?: boolean): Float64Array {
        length = length == null ? this.byteLength - this.position / 8 : length;
        const arr = new Float64Array(length);
        DataStream.memcpy(
            arr.buffer,
            0,
            this.buffer,
            this.byteOffset + this.position,
            length * arr.BYTES_PER_ELEMENT
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Reads a Float32Array of desired length and endianness from the DataStream.
     *
     * @param {number} length Number of elements to map.
     * @param {?boolean} e Endianness of the data to read.
     * @return {Object} The read Float32Array.
     */
    readFloat32Array(length: number, e?: boolean): Float32Array {
        length = length == null ? this.byteLength - this.position / 4 : length;
        const arr = new Float32Array(length);
        DataStream.memcpy(
            arr.buffer,
            0,
            this.buffer,
            this.byteOffset + this.position,
            length * arr.BYTES_PER_ELEMENT
        );
        DataStream.arrayToNative(arr, e == null ? this.endianness : e);
        this.position += arr.byteLength;
        return arr;
    }

    /**
     * Writes an Int32Array of specified endianness to the DataStream.
     *
     * @param {Object} arr The array to write.
     * @param {?boolean} e Endianness of the data to write.
     */
    writeInt32Array(arr: Int32Array | number[], e?: boolean): DataStream {
        this._realloc(arr.length * 4);
        if (
            arr instanceof Int32Array &&
            (this.byteOffset + this.position) % arr.BYTES_PER_ELEMENT === 0
        ) {
            DataStream.memcpy(
                this._buffer,
                this.byteOffset + this.position,
                arr.buffer,
                arr.byteOffset,
                arr.byteLength
            );
            this.mapInt32Array(arr.length, e);
        } else {
            // tslint:disable-next-line prefer-for-of
            for (let i = 0; i < arr.length; i++) {
                this.writeInt32(arr[i], e);
            }
        }
        return this;
    }

    /**
     * Writes an Int16Array of specified endianness to the DataStream.
     *
     * @param {Object} arr The array to write.
     * @param {?boolean} e Endianness of the data to write.
     */
    writeInt16Array(arr: Int16Array | number[], e?: boolean): DataStream {
        this._realloc(arr.length * 2);
        if (
            arr instanceof Int16Array &&
            (this.byteOffset + this.position) % arr.BYTES_PER_ELEMENT === 0
        ) {
            DataStream.memcpy(
                this._buffer,
                this.byteOffset + this.position,
                arr.buffer,
                arr.byteOffset,
                arr.byteLength
            );
            this.mapInt16Array(arr.length, e);
        } else {
            // tslint:disable-next-line prefer-for-of
            for (let i = 0; i < arr.length; i++) {
                this.writeInt16(arr[i], e);
            }
        }
        return this;
    }

    /**
     * Writes an Int8Array to the DataStream.
     *
     * @param {Object} arr The array to write.
     */
    writeInt8Array(arr: Int8Array | number[]): DataStream {
        this._realloc(arr.length);
        if (
            arr instanceof Int8Array &&
            (this.byteOffset + this.position) % arr.BYTES_PER_ELEMENT === 0
        ) {
            DataStream.memcpy(
                this._buffer,
                this.byteOffset + this.position,
                arr.buffer,
                arr.byteOffset,
                arr.byteLength
            );
            this.mapInt8Array(arr.length);
        } else {
            // tslint:disable-next-line prefer-for-of
            for (let i = 0; i < arr.length; i++) {
                this.writeInt8(arr[i]);
            }
        }
        return this;
    }

    /**
     * Writes a Uint32Array of specified endianness to the DataStream.
     *
     * @param {Object} arr The array to write.
     * @param {?boolean} e Endianness of the data to write.
     */
    writeUint32Array(arr: Uint32Array | number[], e?: boolean): DataStream {
        this._realloc(arr.length * 4);
        if (
            arr instanceof Uint32Array &&
            (this.byteOffset + this.position) % arr.BYTES_PER_ELEMENT === 0
        ) {
            DataStream.memcpy(
                this._buffer,
                this.byteOffset + this.position,
                arr.buffer,
                arr.byteOffset,
                arr.byteLength
            );
            this.mapUint32Array(arr.length, e);
        } else {
            // tslint:disable-next-line prefer-for-of
            for (let i = 0; i < arr.length; i++) {
                this.writeUint32(arr[i], e);
            }
        }
        return this;
    }

    /**
     * Writes a Uint16Array of specified endianness to the DataStream.
     *
     * @param {Object} arr The array to write.
     * @param {?boolean} e Endianness of the data to write.
     */
    writeUint16Array(arr: Uint16Array | number[], e?: boolean): DataStream {
        this._realloc(arr.length * 2);
        if (
            arr instanceof Uint16Array &&
            (this.byteOffset + this.position) % arr.BYTES_PER_ELEMENT === 0
        ) {
            DataStream.memcpy(
                this._buffer,
                this.byteOffset + this.position,
                arr.buffer,
                arr.byteOffset,
                arr.byteLength
            );
            this.mapUint16Array(arr.length, e);
        } else {
            // tslint:disable-next-line prefer-for-of
            for (let i = 0; i < arr.length; i++) {
                this.writeUint16(arr[i], e);
            }
        }
        return this;
    }

    /**
     * Writes a Uint8Array to the DataStream.
     *
     * @param {Object} arr The array to write.
     */
    writeUint8Array(arr: Uint8Array | number[]): DataStream {
        this._realloc(arr.length);
        if (
            arr instanceof Uint8Array &&
            (this.byteOffset + this.position) % arr.BYTES_PER_ELEMENT === 0
        ) {
            DataStream.memcpy(
                this._buffer,
                this.byteOffset + this.position,
                arr.buffer,
                arr.byteOffset,
                arr.byteLength
            );
            this.mapUint8Array(arr.length);
        } else {
            // tslint:disable-next-line prefer-for-of
            for (let i = 0; i < arr.length; i++) {
                this.writeUint8(arr[i]);
            }
        }
        return this;
    }

    /**
     * Writes a Float64Array of specified endianness to the DataStream.
     *
     * @param {Object} arr The array to write.
     * @param {?boolean} e Endianness of the data to write.
     */
    writeFloat64Array(arr: Float64Array | number[], e?: boolean): DataStream {
        this._realloc(arr.length * 8);
        if (
            arr instanceof Float64Array &&
            (this.byteOffset + this.position) % arr.BYTES_PER_ELEMENT === 0
        ) {
            DataStream.memcpy(
                this._buffer,
                this.byteOffset + this.position,
                arr.buffer,
                arr.byteOffset,
                arr.byteLength
            );
            this.mapFloat64Array(arr.length, e);
        } else {
            // tslint:disable-next-line prefer-for-of
            for (let i = 0; i < arr.length; i++) {
                this.writeFloat64(arr[i], e);
            }
        }
        return this;
    }

    /**
     * Writes a Float32Array of specified endianness to the DataStream.
     *
     * @param {Object} arr The array to write.
     * @param {?boolean} e Endianness of the data to write.
     */
    writeFloat32Array(arr: Float32Array | number[], e?: boolean): DataStream {
        this._realloc(arr.length * 4);
        if (
            arr instanceof Float32Array &&
            (this.byteOffset + this.position) % arr.BYTES_PER_ELEMENT === 0
        ) {
            DataStream.memcpy(
                this._buffer,
                this.byteOffset + this.position,
                arr.buffer,
                arr.byteOffset,
                arr.byteLength
            );
            this.mapFloat32Array(arr.length, e);
        } else {
            // tslint:disable-next-line prefer-for-of
            for (let i = 0; i < arr.length; i++) {
                this.writeFloat32(arr[i], e);
            }
        }
        return this;
    }

    /**
     * Reads a 32-bit int from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readInt32(e?: boolean): number {
        const v = this._dataView.getInt32(
            this.position,
            e == null ? this.endianness : e
        );
        this.position += 4;
        return v;
    }

    /**
     * Reads a 16-bit int from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readInt16(e?: boolean): number {
        const v = this._dataView.getInt16(
            this.position,
            e == null ? this.endianness : e
        );
        this.position += 2;
        return v;
    }

    /**
     * Reads an 8-bit int from the DataStream.
     *
     * @return {number} The read number.
     */
    readInt8(): number {
        const v = this._dataView.getInt8(this.position);
        this.position += 1;
        return v;
    }

    /**
     * Reads a 32-bit unsigned int from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readUint32(e?: boolean): number {
        const v = this._dataView.getUint32(
            this.position,
            e == null ? this.endianness : e
        );
        this.position += 4;
        return v;
    }

    /**
     * Reads a 16-bit unsigned int from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readUint16(e?: boolean): number {
        const v = this._dataView.getUint16(
            this.position,
            e == null ? this.endianness : e
        );
        this.position += 2;
        return v;
    }

    /**
     * Reads an 8-bit unsigned int from the DataStream.
     *
     * @return {number} The read number.
     */
    readUint8(): number {
        const v = this._dataView.getUint8(this.position);
        this.position += 1;
        return v;
    }

    /**
     * Reads a 32-bit float from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readFloat32(e?: boolean): number {
        const v = this._dataView.getFloat32(
            this.position,
            e == null ? this.endianness : e
        );
        this.position += 4;
        return v;
    }

    /**
     * Reads a 64-bit float from the DataStream with the desired endianness.
     *
     * @param {?boolean} e Endianness of the number.
     * @return {number} The read number.
     */
    readFloat64(e?: boolean): number {
        const v = this._dataView.getFloat64(
            this.position,
            e == null ? this.endianness : e
        );
        this.position += 8;
        return v;
    }

    /**
     * Writes a 32-bit int to the DataStream with the desired endianness.
     *
     * @param {number} v Number to write.
     * @param {?boolean} e Endianness of the number.
     */
    writeInt32(v: number, e?: boolean): DataStream {
        this._realloc(4);
        this._dataView.setInt32(
            this.position,
            v,
            e == null ? this.endianness : e
        );
        this.position += 4;
        return this;
    }

    /**
     * Writes a 16-bit int to the DataStream with the desired endianness.
     *
     * @param {number} v Number to write.
     * @param {?boolean} e Endianness of the number.
     */
    writeInt16(v: number, e?: boolean): DataStream {
        this._realloc(2);
        this._dataView.setInt16(
            this.position,
            v,
            e == null ? this.endianness : e
        );
        this.position += 2;
        return this;
    }

    /**
     * Writes an 8-bit int to the DataStream.
     *
     * @param {number} v Number to write.
     */
    writeInt8(v: number): DataStream {
        this._realloc(1);
        this._dataView.setInt8(this.position, v);
        this.position += 1;
        return this;
    }

    /**
     * Writes a 32-bit unsigned int to the DataStream with the desired endianness.
     *
     * @param {number} v Number to write.
     * @param {?boolean} e Endianness of the number.
     */
    writeUint32(v: number, e?: boolean): DataStream {
        this._realloc(4);
        this._dataView.setUint32(
            this.position,
            v,
            e == null ? this.endianness : e
        );
        this.position += 4;
        return this;
    }

    /**
     * Writes a 16-bit unsigned int to the DataStream with the desired endianness.
     *
     * @param {number} v Number to write.
     * @param {?boolean} e Endianness of the number.
     */
    writeUint16(v: number, e?: boolean): DataStream {
        this._realloc(2);
        this._dataView.setUint16(
            this.position,
            v,
            e == null ? this.endianness : e
        );
        this.position += 2;
        return this;
    }

    /**
     * Writes an 8-bit unsigned  int to the DataStream.
     *
     * @param {number} v Number to write.
     */
    writeUint8(v: number): DataStream {
        this._realloc(1);
        this._dataView.setUint8(this.position, v);
        this.position += 1;
        return this;
    }

    /**
     * Writes a 32-bit float to the DataStream with the desired endianness.
     *
     * @param {number} v Number to write.
     * @param {?boolean} e Endianness of the number.
     */
    writeFloat32(v: number, e?: boolean): DataStream {
        this._realloc(4);
        this._dataView.setFloat32(
            this.position,
            v,
            e == null ? this.endianness : e
        );
        this.position += 4;
        return this;
    }

    /**
     * Writes a 64-bit float to the DataStream with the desired endianness.
     *
     * @param {number} v Number to write.
     * @param {?boolean} e Endianness of the number.
     */
    writeFloat64(v: number, e?: boolean): DataStream {
        this._realloc(8);
        this._dataView.setFloat64(
            this.position,
            v,
            e == null ? this.endianness : e
        );
        this.position += 8;
        return this;
    }

    /**
     * Native endianness. Either DataStream.BIG_ENDIAN or DataStream.LITTLE_ENDIAN
     * depending on the platform endianness.
     *
     * @type {boolean}
     */
    static readonly endianness: boolean = new Int8Array(
        new Int16Array([1]).buffer
    )[0] > 0;

    /**
     * Copies byteLength bytes from the src buffer at srcOffset to the
     * dst buffer at dstOffset.
     *
     * @param {Object} dst Destination ArrayBuffer to write to.
     * @param {number} dstOffset Offset to the destination ArrayBuffer.
     * @param {Object} src Source ArrayBuffer to read from.
     * @param {number} srcOffset Offset to the source ArrayBuffer.
     * @param {number} byteLength Number of bytes to copy.
     */
    static memcpy(
        dst: ArrayBufferLike,
        dstOffset: number,
        src: ArrayBuffer,
        srcOffset: number,
        byteLength: number
    ) {
        const dstU8 = new Uint8Array(dst, dstOffset, byteLength);
        const srcU8 = new Uint8Array(src, srcOffset, byteLength);
        dstU8.set(srcU8);
    }

    /**
     * Converts array to native endianness in-place.
     *
     * @param {Object} array Typed array to convert.
     * @param {boolean} arrayIsLittleEndian True if the data in the array is
     * little-endian. Set false for big-endian.
     * @return {Object} The converted typed array.
     */
    static arrayToNative(array, arrayIsLittleEndian: boolean) {
        if (arrayIsLittleEndian === this.endianness) {
            return array;
        } else {
            return this.flipArrayEndianness(array); // ???
        }
    }

    /**
     * Converts native endianness array to desired endianness in-place.
     *
     * @param {Object} array Typed array to convert.
     * @param {boolean} littleEndian True if the converted array should be
     * little-endian. Set false for big-endian.
     * @return {Object} The converted typed array.
     */
    static nativeToEndian(array: TypedArray, littleEndian: boolean) {
        if (this.endianness === littleEndian) {
            return array;
        } else {
            return this.flipArrayEndianness(array);
        }
    }

    /**
     * Flips typed array endianness in-place.
     *
     * @param {Object} array Typed array to flip.
     * @return {Object} The converted typed array.
     */
    static flipArrayEndianness(array: TypedArray) {
        const u8 = new Uint8Array(
            array.buffer,
            array.byteOffset,
            array.byteLength
        );
        for (let i = 0; i < array.byteLength; i += array.BYTES_PER_ELEMENT) {
            for (
                // tslint:disable-next-line one-variable-per-declaration
                let j = i + array.BYTES_PER_ELEMENT - 1, k = i;
                j > k;
                j--, k++
            ) {
                const tmp = u8[k];
                u8[k] = u8[j];
                u8[j] = tmp;
            }
        }
        return array;
    }

    /**
     * Creates an array from an array of character codes.
     * Uses String.fromCharCode in chunks for memory efficiency and then concatenates
     * the resulting string chunks.
     *
     * @param {TypedArray} array Array of character codes.
     * @return {string} String created from the character codes.
     */
    static createStringFromArray(array: TypedArray) {
        const chunkSize = 0x8000;
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(
                String.fromCharCode.apply(
                    null,
                    array.subarray(i, i + chunkSize)
                )
            );
        }
        return chunks.join("");
    }

    /**
     * Seek position where DataStream#readStruct ran into a problem.
     * Useful for debugging struct parsing.
     *
     * @type {number}
     */
    failurePosition = 0;

    /**
     * Reads a struct of data from the DataStream. The struct is defined as
     * a flat array of [name, type]-pairs. See the example below:
     *
     * ds.readStruct([
     * 'headerTag', 'uint32', // Uint32 in DataStream endianness.
     * 'headerTag2', 'uint32be', // Big-endian Uint32.
     * 'headerTag3', 'uint32le', // Little-endian Uint32.
     * 'array', ['[]', 'uint32', 16], // Uint32Array of length 16.
     * 'array2Length', 'uint32',
     * 'array2', ['[]', 'uint32', 'array2Length'] // Uint32Array of length array2Length
     * ]);
     *
     * The possible values for the type are as follows:
     *
     * // Number types
     *
     * // Unsuffixed number types use DataStream endianness.
     * // To explicitly specify endianness, suffix the type with
     * // 'le' for little-endian or 'be' for big-endian,
     * // e.g. 'int32be' for big-endian int32.
     *
     * 'uint8' -- 8-bit unsigned int
     * 'uint16' -- 16-bit unsigned int
     * 'uint32' -- 32-bit unsigned int
     * 'int8' -- 8-bit int
     * 'int16' -- 16-bit int
     * 'int32' -- 32-bit int
     * 'float32' -- 32-bit float
     * 'float64' -- 64-bit float
     *
     * // String types
     * 'cstring' -- ASCII string terminated by a zero byte.
     * 'string:N' -- ASCII string of length N, where N is a literal integer.
     * 'string:variableName' -- ASCII string of length $variableName,
     * where 'variableName' is a previously parsed number in the current struct.
     * 'string,CHARSET:N' -- String of byteLength N encoded with given CHARSET.
     * 'u16string:N' -- UCS-2 string of length N in DataStream endianness.
     * 'u16stringle:N' -- UCS-2 string of length N in little-endian.
     * 'u16stringbe:N' -- UCS-2 string of length N in big-endian.
     *
     * // Complex types
     * [name, type, name_2, type_2, ..., name_N, type_N] -- Struct
     * function(dataStream, struct) {} -- Callback function to read and return data.
     * {get: function(dataStream, struct) {},
     *  set: function(dataStream, struct) {}}
     * -- Getter/setter functions to read and return data, handy for using the same
     * struct definition for reading and writing structs.
     * ['[]', type, length] -- Array of given type and length. The length can be either
     * a number, a string that references a previously-read
     * field, or a callback function(struct, dataStream, type){}.
     * If length is '*', reads in as many elements as it can.
     *
     * @param {Object} structDefinition Struct definition object.
     * @return {Object} The read struct. Null if failed to read struct.
     *
     * @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct
     */
    readStruct(structDefinition: StructRead[]): object {
        const struct = {};
        let t: StructRead;
        let v;
        const p = this.position;
        for (let i = 0; i < structDefinition.length; i += 2) {
            t = structDefinition[i + 1];
            v = this.readType(t, struct);
            if (v == null) {
                if (this.failurePosition === 0) {
                    this.failurePosition = this.position;
                }
                this.position = p;
                return null;
            }
            struct[structDefinition[i] as string] = v;
        }
        return struct;
    }

    /** ex:
     * const def = [
     *      ["obj", [["num", "Int8"],
     *               ["greet", "Utf8WithLen"],
     *               ["a1", "Int16*"]]
     *      ],
     *      ["a2", "Uint16*"]
     *  ];
     *  const o = {obj: {
     *          num: 5,
     *          greet: "Xin chào",
     *          a1: [-3, 0, 4, 9, 0x7FFF],
     *      },
     *      a2: [3, 0, 4, 9, 0xFFFF]
     *  });
     *  ds.write(def, o);
     *  expect: new DataStream(ds.buffer).read(def) deepEqual o
     */
    read(def: TypeDef): object {
        const o = {};
        let d: TypeDef1;
        for (d of def) {
            const v = d[0];
            const t = d[1];
            if (typeof t === "string") {
                if (t.endsWith("*")) {
                    const len = this.readUint16();
                    o[v] = this["read" + t.substr(0, t.length - 1) + "Array"](
                        len
                    );
                } else {
                    o[v] = this["read" + t]();
                }
            } else {
                o[v] = this.read(t);
            }
        }
        return o;
    }

    /** ex:
     * const def = [
     *      ["obj", [["num", "Int8"],
     *               ["greet", "Utf8WithLen"],
     *               ["a1", "Int16*"]]
     *      ],
     *      ["a2", "Uint16*"]
     *  ];
     *  const o = {obj: {
     *          num: 5,
     *          greet: "Xin chào",
     *          a1: [-3, 0, 4, 9, 0x7FFF],
     *      },
     *      a2: [3, 0, 4, 9, 0xFFFF]
     *  });
     *  ds.write(def, o);
     *  expect: new DataStream(ds.buffer).read(def) deepEqual o
     */
    write(def: TypeDef, o: object): DataStream {
        let d: TypeDef1;
        for (d of def) {
            const v = d[0];
            const t = d[1];
            if (typeof t === "string") {
                if (t.endsWith("*")) {
                    const arr: TypedArray | number[] = o[v];
                    this.writeUint16(arr.length);
                    this["write" + t.substr(0, t.length - 1) + "Array"](arr);
                } else {
                    this["write" + t](o[v]);
                }
            } else {
                this.write(t, o[v]);
            }
        }
        return this;
    }

    /** convenient method to write data. ex, instead of write data as in jsdoc of `write` method, we can:
     * const def = [
     *      ["Int8", "Utf8WithLen", "Int16*"],
     *      "Uint16*"
     *  ];
     *  const a = [
     *      [5, "Xin chào", [-3, 0, 4, 9, 0x7FFF]],
     *      [3, 0, 4, 9, 0xFFFF]
     *  ];
     *  ds.writeArray(def, a)
     */
    writeArray(def: TypeArr, a: any[]): DataStream {
        let t: Type | TypeArr;
        let i: number;
        for (i = 0; i < def.length; i++) {
            t = def[i];
            if (typeof t === "string") {
                if (t.endsWith("*")) {
                    const arr: TypedArray | number[] = a[i];
                    this.writeUint16(arr.length);
                    this["write" + t.substr(0, t.length - 1) + "Array"](arr);
                } else {
                    this["write" + t](a[i]);
                }
            } else {
                this.writeArray(t, a[i]);
            }
        }
        return this;
    }

    /**
     * Read UCS-2 string of desired length and endianness from the DataStream.
     *
     * @param {number} length The length of the string to read.
     * @param {boolean} endianness The endianness of the string data in the DataStream.
     * @return {string} The read string.
     */
    readUCS2String(length: number, endianness?: boolean): string {
        return DataStream.createStringFromArray(
            this.readUint16Array(length, endianness)
        );
    }

    /**
     * Write a UCS-2 string of desired endianness to the DataStream. The
     * lengthOverride argument lets you define the number of characters to write.
     * If the string is shorter than lengthOverride, the extra space is padded with
     * zeroes.
     *
     * @param {string} str The string to write.
     * @param {?boolean} endianness The endianness to use for the written string data.
     * @param {?number} lengthOverride The number of characters to write.
     */
    writeUCS2String(
        str: string,
        endianness?: boolean,
        lengthOverride?: number
    ): DataStream {
        if (lengthOverride == null) {
            lengthOverride = str.length;
        }
        let i = 0;
        for (; i < str.length && i < lengthOverride; i++) {
            this.writeUint16(str.charCodeAt(i), endianness);
        }
        for (; i < lengthOverride; i++) {
            this.writeUint16(0);
        }
        return this;
    }

    /**
     * Read a string of desired length and encoding from the DataStream.
     *
     * @param {number} length The length of the string to read in bytes.
     * @param {?string} encoding The encoding of the string data in the DataStream.
     * Defaults to ASCII.
     * @return {string} The read string.
     */
    readString(length: number, encoding?: string): string {
        if (encoding == null || encoding === "ASCII") {
            return DataStream.createStringFromArray(
                this.mapUint8Array(
                    length == null ? this.byteLength - this.position : length
                )
            );
        } else {
            return new TextDecoder(encoding).decode(this.mapUint8Array(length));
        }
    }

    /**
     * Writes a string of desired length and encoding to the DataStream.
     *
     * @param {string} s The string to write.
     * @param {?string} encoding The encoding for the written string data.
     * Defaults to ASCII.
     * @param {?number} length The number of characters to write.
     */
    writeString(s: string, encoding?: string, length?: number): DataStream {
        if (encoding == null || encoding === "ASCII") {
            if (length != null) {
                let i: number;
                const len = Math.min(s.length, length);
                for (i = 0; i < len; i++) {
                    this.writeUint8(s.charCodeAt(i));
                }
                for (; i < length; i++) {
                    this.writeUint8(0);
                }
            } else {
                for (let i = 0; i < s.length; i++) {
                    this.writeUint8(s.charCodeAt(i));
                }
            }
        } else {
            this.writeUint8Array(
                new TextEncoder(encoding).encode(s.substring(0, length))
            );
        }
        return this;
    }

    /** writeUint16(utf8 length of `s`) then write utf8 `s` */
    writeUtf8WithLen(s: string): DataStream {
        const arr = new TextEncoder("utf-8").encode(s);
        return this.writeUint16(arr.length).writeUint8Array(arr);
    }

    /** readUint16 into `len` then read `len` Uint8 then parse into the result utf8 string */
    readUtf8WithLen(): string {
        const len = this.readUint16();
        return new TextDecoder("utf-8").decode(this.mapUint8Array(len));
    }

    /**
     * Read null-terminated string of desired length from the DataStream. Truncates
     * the returned string so that the null byte is not a part of it.
     *
     * @param {?number} length The length of the string to read.
     * @return {string} The read string.
     */
    readCString(length?: number): string {
        const blen = this.byteLength - this.position;
        const u8 = new Uint8Array(
            this._buffer,
            this._byteOffset + this.position
        );
        let len = blen;
        if (length != null) {
            len = Math.min(length, blen);
        }
        let i = 0;
        for (; i < len && u8[i] !== 0; i++) {
            // find first zero byte
        }
        const s = DataStream.createStringFromArray(this.mapUint8Array(i));
        if (length != null) {
            this.position += len - i;
        } else if (i !== blen) {
            this.position += 1; // trailing zero if not at end of buffer
        }
        return s;
    }

    /**
     * Writes a null-terminated string to DataStream and zero-pads it to length
     * bytes. If length is not given, writes the string followed by a zero.
     * If string is longer than length, the written part of the string does not have
     * a trailing zero.
     *
     * @param {string} s The string to write.
     * @param {?number} length The number of characters to write.
     */
    writeCString(s: string, length?: number): DataStream {
        if (length != null) {
            let i: number;
            const len = Math.min(s.length, length);
            for (i = 0; i < len; i++) {
                this.writeUint8(s.charCodeAt(i));
            }
            for (; i < length; i++) {
                this.writeUint8(0);
            }
        } else {
            for (let i = 0; i < s.length; i++) {
                this.writeUint8(s.charCodeAt(i));
            }
            this.writeUint8(0);
        }
        return this;
    }

    /**
     * Reads an object of type t from the DataStream, passing struct as the thus-far
     * read struct to possible callbacks that refer to it. Used by readStruct for
     * reading in the values, so the type is one of the readStruct types.
     *
     * @param {Object} t Type of the object to read.
     * @param {?Object} struct Struct to refer to when resolving length references
     * and for calling callbacks.
     * @return {?Object} Returns the object on successful read, null on unsuccessful.
     */
    readType(t: StructRead, struct: object): any {
        if (typeof t === "function") {
            return t(this, struct);
        } else if (typeof t === "object" && !(t instanceof Array)) {
            return t.get(this, struct);
        } else if (t instanceof Array && t.length !== 3) {
            return this.readStruct(t as StructRead[]);
        }
        let v = null;
        let lengthOverride = null;
        let charset = "ASCII";
        const pos = this.position;
        if (typeof t === "string" && /:/.test(t)) {
            const tp = t.split(":");
            t = tp[0];
            const len = tp[1];

            // allow length to be previously parsed variable
            // e.g. 'string:fieldLength', if `fieldLength` has been parsed previously.
            // else, assume literal integer e.g., 'string:4'
            lengthOverride = parseInt(
                struct[len] != null ? struct[len] : len,
                10
            );
        }
        if (typeof t === "string" && /,/.test(t)) {
            const tp = t.split(",");
            t = tp[0];
            charset = tp[1];
        }
        switch (t) {
            case "uint8":
                v = this.readUint8();
                break;
            case "int8":
                v = this.readInt8();
                break;

            case "uint16":
                v = this.readUint16(this.endianness);
                break;
            case "int16":
                v = this.readInt16(this.endianness);
                break;
            case "uint32":
                v = this.readUint32(this.endianness);
                break;
            case "int32":
                v = this.readInt32(this.endianness);
                break;
            case "float32":
                v = this.readFloat32(this.endianness);
                break;
            case "float64":
                v = this.readFloat64(this.endianness);
                break;

            case "uint16be":
                v = this.readUint16(DataStream.BIG_ENDIAN);
                break;
            case "int16be":
                v = this.readInt16(DataStream.BIG_ENDIAN);
                break;
            case "uint32be":
                v = this.readUint32(DataStream.BIG_ENDIAN);
                break;
            case "int32be":
                v = this.readInt32(DataStream.BIG_ENDIAN);
                break;
            case "float32be":
                v = this.readFloat32(DataStream.BIG_ENDIAN);
                break;
            case "float64be":
                v = this.readFloat64(DataStream.BIG_ENDIAN);
                break;

            case "uint16le":
                v = this.readUint16(DataStream.LITTLE_ENDIAN);
                break;
            case "int16le":
                v = this.readInt16(DataStream.LITTLE_ENDIAN);
                break;
            case "uint32le":
                v = this.readUint32(DataStream.LITTLE_ENDIAN);
                break;
            case "int32le":
                v = this.readInt32(DataStream.LITTLE_ENDIAN);
                break;
            case "float32le":
                v = this.readFloat32(DataStream.LITTLE_ENDIAN);
                break;
            case "float64le":
                v = this.readFloat64(DataStream.LITTLE_ENDIAN);
                break;

            case "cstring":
                v = this.readCString(lengthOverride);
                break;

            case "string":
                v = this.readString(lengthOverride, charset);
                break;

            case "u16string":
                v = this.readUCS2String(lengthOverride, this.endianness);
                break;

            case "u16stringle":
                v = this.readUCS2String(
                    lengthOverride,
                    DataStream.LITTLE_ENDIAN
                );
                break;

            case "u16stringbe":
                v = this.readUCS2String(lengthOverride, DataStream.BIG_ENDIAN);
                break;

            default:
                if (t.length === 3) {
                    const ta = t[1] as string;
                    const len = t[2];
                    let length = 0;
                    if (typeof len === "function") {
                        length = len(struct, this, t);
                    } else if (typeof len === "string" && struct[len] != null) {
                        length = parseInt(struct[len], 10);
                    } else {
                        length = parseInt(len as string, 10);
                    }
                    if (typeof ta === "string") {
                        const tap = ta.replace(/(le|be)$/, "");
                        let endianness = null;
                        if (/le$/.test(ta)) {
                            endianness = DataStream.LITTLE_ENDIAN;
                        } else if (/be$/.test(ta)) {
                            endianness = DataStream.BIG_ENDIAN;
                        }
                        if (len === "*") {
                            length = null;
                        }
                        switch (tap) {
                            case "uint8":
                                v = this.readUint8Array(length);
                                break;
                            case "uint16":
                                v = this.readUint16Array(length, endianness);
                                break;
                            case "uint32":
                                v = this.readUint32Array(length, endianness);
                                break;
                            case "int8":
                                v = this.readInt8Array(length);
                                break;
                            case "int16":
                                v = this.readInt16Array(length, endianness);
                                break;
                            case "int32":
                                v = this.readInt32Array(length, endianness);
                                break;
                            case "float32":
                                v = this.readFloat32Array(length, endianness);
                                break;
                            case "float64":
                                v = this.readFloat64Array(length, endianness);
                                break;
                            case "cstring":
                            case "utf16string":
                            case "string":
                                if (length == null) {
                                    v = [];
                                    while (!this.isEof()) {
                                        const u = this.readType(ta, struct);
                                        if (u == null) break;
                                        v.push(u);
                                    }
                                } else {
                                    v = new Array(length);
                                    for (let i = 0; i < length; i++) {
                                        v[i] = this.readType(ta, struct);
                                    }
                                }
                                break;
                        }
                    } else {
                        if (len === "*") {
                            v = [];
                            while (true) {
                                const p = this.position;
                                try {
                                    const o = this.readType(ta, struct);
                                    if (o == null) {
                                        this.position = p;
                                        break;
                                    }
                                    v.push(o);
                                } catch (e) {
                                    this.position = p;
                                    break;
                                }
                            }
                        } else {
                            v = new Array(length);
                            for (let i = 0; i < length; i++) {
                                const u = this.readType(ta, struct);
                                if (u == null) return null;
                                v[i] = u;
                            }
                        }
                    }
                    break;
                }
        }
        if (lengthOverride != null) {
            this.position = pos + lengthOverride;
        }
        return v;
    }

    /**
     * Writes a struct to the DataStream. Takes a structDefinition that gives the
     * types and a struct object that gives the values. Refer to readStruct for the
     * structure of structDefinition.
     *
     * @param {Object} structDefinition Type definition of the struct.
     * @param {Object} struct The struct data object.
     * @param needConvertStructDef if set (== true) then structDefinition will be convert using
     *        `DataStream.defWriteStruct` before writing.
     *
     * @deprecated use DataStream.read/write(TypeDef) instead of readStruct/writeStruct
     */
    writeStruct(
        structDefinition: StructWrite[] | StructRead[],
        struct: object,
        needConvertStructDef: boolean = false
    ): DataStream {
        if (needConvertStructDef) {
            structDefinition = DataStream.defWriteStruct(
                structDefinition as StructRead[],
                struct
            );
        }
        for (let i = 0; i < structDefinition.length; i += 2) {
            const t = structDefinition[i + 1];
            this.writeType(
                t as StructWrite,
                struct[structDefinition[i] as string],
                struct
            );
        }
        return this;
    }

    /**
     * Convert a struct definition using for `readStruct` to a struct definition that can be using for `writeStruct`
     * @param readStructDef ex ['len', 'uint8', 'greet', 'string,utf-8:some_len_var_name']
     * @param struct The actual struct will be writing, ex {greet: 'Xin Chào'}
     * @return {Array<*>} the readStructDef with all string type that has encoding specified
     *          (ex 'string,utf-8:some_len_var_name')
     *            be replaced by a `function` that write the correspond string field in `struct` (ex, struct.greet)
     * @side-effect struct is modified: struct.<some_len_var_name> is set = length of the string field
     *          (ex, struct.greet) after encode.
     */
    static defWriteStruct(
        readStructDef: StructRead[],
        struct: object
    ): StructWrite[] {
        const ret: StructWrite[] = [];
        for (let i = readStructDef.length - 2; i >= 0; i -= 2) {
            let t = readStructDef[i + 1];
            const v = readStructDef[i] as string;
            if (typeof t === "string" && /,.+:[A-Za-z_]/.test(t)) {
                let tp = t.split(":");
                const len = tp[1];
                tp = tp[0].split(",");
                t = tp[0];
                const charset = tp[1];

                const uint8Array = new TextEncoder(charset).encode(
                    struct[v as string]
                );
                struct[len] = uint8Array.length;
                ret.push(ds => ds.writeUint8Array(uint8Array));
            } else {
                ret.push(t as StructWrite); // FIXME StructWriteFn is not compatible withi StructReadFn
            }
            ret.push(v);
        }
        return ret.reverse();
    }

    /**
     * Writes object v of type t to the DataStream.
     *
     * @param {Object} t Type of data to write.
     * @param {Object} v Value of data to write.
     * @param {Object} struct Struct to pass to write callback functions.
     */
    writeType(t: StructWrite, v: any, struct: object): DataStream {
        if (typeof t === "function") {
            t(this, v, struct);
            return this;
        } else if (typeof t === "object" && !(t instanceof Array)) {
            t.set(this, v, struct);
            return this;
        }
        let lengthOverride = null;
        let charset = "ASCII";
        const pos = this.position;
        if (typeof t === "string" && /:/.test(t)) {
            const tp = t.split(":");
            t = tp[0];
            const len = tp[1];

            // allow length to be previously parsed variable
            // e.g. 'string:fieldLength', if `fieldLength` has been parsed previously.
            // else, assume literal integer e.g., 'string:4'
            lengthOverride = parseInt(
                struct[len] != null ? struct[len] : len,
                10
            );
        }
        if (typeof t === "string" && /,/.test(t)) {
            const tp = t.split(",");
            t = tp[0];
            charset = tp[1];
        }

        switch (t) {
            case "uint8":
                this.writeUint8(v);
                break;
            case "int8":
                this.writeInt8(v);
                break;

            case "uint16":
                this.writeUint16(v, this.endianness);
                break;
            case "int16":
                this.writeInt16(v, this.endianness);
                break;
            case "uint32":
                this.writeUint32(v, this.endianness);
                break;
            case "int32":
                this.writeInt32(v, this.endianness);
                break;
            case "float32":
                this.writeFloat32(v, this.endianness);
                break;
            case "float64":
                this.writeFloat64(v, this.endianness);
                break;

            case "uint16be":
                this.writeUint16(v, DataStream.BIG_ENDIAN);
                break;
            case "int16be":
                this.writeInt16(v, DataStream.BIG_ENDIAN);
                break;
            case "uint32be":
                this.writeUint32(v, DataStream.BIG_ENDIAN);
                break;
            case "int32be":
                this.writeInt32(v, DataStream.BIG_ENDIAN);
                break;
            case "float32be":
                this.writeFloat32(v, DataStream.BIG_ENDIAN);
                break;
            case "float64be":
                this.writeFloat64(v, DataStream.BIG_ENDIAN);
                break;

            case "uint16le":
                this.writeUint16(v, DataStream.LITTLE_ENDIAN);
                break;
            case "int16le":
                this.writeInt16(v, DataStream.LITTLE_ENDIAN);
                break;
            case "uint32le":
                this.writeUint32(v, DataStream.LITTLE_ENDIAN);
                break;
            case "int32le":
                this.writeInt32(v, DataStream.LITTLE_ENDIAN);
                break;
            case "float32le":
                this.writeFloat32(v, DataStream.LITTLE_ENDIAN);
                break;
            case "float64le":
                this.writeFloat64(v, DataStream.LITTLE_ENDIAN);
                break;

            case "cstring":
                this.writeCString(v, lengthOverride);
                break;

            case "string":
                this.writeString(v, charset, lengthOverride);
                break;

            case "u16string":
                this.writeUCS2String(v, this.endianness, lengthOverride);
                break;

            case "u16stringle":
                this.writeUCS2String(
                    v,
                    DataStream.LITTLE_ENDIAN,
                    lengthOverride
                );
                break;

            case "u16stringbe":
                this.writeUCS2String(v, DataStream.BIG_ENDIAN, lengthOverride);
                break;

            default:
                // t instanceof Array
                if (t.length === 3) {
                    const ta: StructWrite = t[1];
                    for (const vi of v) {
                        this.writeType(ta, vi, struct);
                    }
                    break;
                } else {
                    this.writeStruct(t as StructWrite[], v);
                    break;
                }
        }
        if (lengthOverride != null) {
            this.position = pos;
            this._realloc(lengthOverride);
            this.position = pos + lengthOverride;
        }
        return this;
    }
}
