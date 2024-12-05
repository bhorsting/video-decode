// TODO Fix this class
// @ts-ignore
export class BufferStream extends ReadableStream {
  buf: any[] = [];
  res: any = null;

  constructor() {
    super({
      pull: async (controller) => {
        while (!this.buf.length) {
          // @ts-ignore
          await new Promise((res) => (this.res = res));
        }
        const next = this.buf.shift();
        if (next !== null) controller.enqueue(next);
        else controller.close();
      },
    });
  }

  push(next: any) {
    this.buf.push(next);
    if (this.res) {
      const res = this.res;
      this.res = null;
      res();
    }
  }
}
