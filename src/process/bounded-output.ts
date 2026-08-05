export const MAX_OUTPUT_BYTES = 32 * 1024;
export const TRUNCATION_MARKER = "\n… output truncated by package-consumer-check …";

export class BoundedOutput {
  readonly #limit: number;
  #value = "";
  #truncated = false;

  constructor(limit = MAX_OUTPUT_BYTES) {
    this.#limit = Math.max(0, limit);
  }

  append(chunk: string | Buffer): void {
    if (this.#truncated) return;
    const text = chunk.toString();
    const remaining = this.#limit - Buffer.byteLength(this.#value);
    if (Buffer.byteLength(text) <= remaining) {
      this.#value += text;
      return;
    }
    this.#value += Buffer.from(text).subarray(0, Math.max(0, remaining)).toString();
    this.#truncated = true;
  }

  get value(): string {
    return this.#value + (this.#truncated ? TRUNCATION_MARKER : "");
  }

  get truncated(): boolean {
    return this.#truncated;
  }
}
