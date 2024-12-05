import { LibAVDemuxer } from "./demux/LibAVDemuxer.ts";

export class VideoFrameExtractor {
  private video: HTMLVideoElement;
  private fps: number = 0;
  private decodedFrames: VideoFrame[] = [];
  private canvas: OffscreenCanvas | null = null;
  private videoDecoder: VideoDecoder | undefined;
  private samples: any[] = [];

  private decodeResolver?: (value: VideoFrame) => void;
  private decodePromise?: Promise<VideoFrame>;
  private requestedFrameIndex: number = Infinity;
  private parsePromise: Promise<void>;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.decodePromise = new Promise<VideoFrame>((resolve) => {
      this.decodeResolver = resolve;
    });
  }

  overrideCurrentTime() {
    const self = this;
    // Create a handler for currentTime
    Object.defineProperty(this.video, "currentTime", {
      get: function () {
        // Return the stored _currentTime
        return this._currentTime || 0;
      },
      set: async function (value) {
        console.log("Setting currentTime:", value, self.parsePromise);
        await self.parsePromise;
        console.log("Set currentTime:", value);

        // Calculate the frame index
        const frameIndex = Math.ceil(value * self.fps);
        self.requestedFrameIndex = frameIndex;

        // Decode the frame or fetch from cache
        let frame: VideoFrame = self.decodedFrames[frameIndex];
        if (!frame) {
          frame = await self.createVideoFrameFromSample(frameIndex);
        }

        // Draw the frame to the canvas and update the poster
        const ctx = self.canvas!.getContext("2d");
        ctx!.drawImage(frame, 0, 0);

        const blob = await self.canvas!.convertToBlob({ type: "image/png" });
        const url = URL.createObjectURL(blob);
        this.setAttribute("poster", url);

        // Store the current time after everything is set
        this._currentTime = value;

        console.log("Poster updated and currentTime set:", value);
        self.video.dispatchEvent(new Event("timeupdate"));
      },
      configurable: true,
      enumerable: true,
    });
  }

  async start() {
    this.decodedFrames = [];
    this.samples = [];
    this.overrideCurrentTime();
    this.parsePromise = this.parseVideo(this.video.src);
    this.parsePromise.then(() => {
      console.log("parsePromise done. FPS:", this.fps);
      this.replaceVideoWithImage();
    });
  }

  sampleIsSync(sample: any) {
    console.log("sampleIsSync:", sample.is_sync);
    return sample.is_sync;
  }

  findClosestSyncSample(sampleIndex: number) {
    let sample = this.samples[sampleIndex];
    let index = sampleIndex;
    while (!this.sampleIsSync(sample) && index > 0) {
      index = index - 1;
      sample = this.samples[index];
    }
    return {
      sample,
      sampleIndex: index,
    };
  }

  encodeSample(sampleIndex: number) {
    console.log("Encoding sample:", sampleIndex);
    if (this.decodedFrames[sampleIndex]) {
      console.log("Sample already encoded:", sampleIndex);
      this.checkShouldResolve(sampleIndex);
      return;
    }
    this.videoDecoder!.decode(this.samples[sampleIndex]);
  }

  async createVideoFrameFromSample(sampleIndex: number): Promise<VideoFrame> {
    // Reset the promise and resolver for each frame request
    this.decodePromise = new Promise<VideoFrame>((resolve) => {
      this.decodeResolver = resolve;
    });

    const sample = this.samples[sampleIndex];
    console.log("Decoding frame:", sampleIndex, sample);
    const closestSyncSample = this.findClosestSyncSample(sampleIndex);
    console.log(
      "Closest sync sample:",
      closestSyncSample,
      "distance:",
      sampleIndex - closestSyncSample.sampleIndex,
    );
    // Encode all frames up to the current frame
    for (let i = closestSyncSample.sampleIndex; i <= sampleIndex; i++) {
      this.encodeSample(i);
    }
    return this.decodePromise!;
  }

  replaceVideoWithImage() {
    if (!this.video) {
      throw new Error("Video element not found");
    }
    if (this.samples.length === 0) {
      throw new Error("No samples demuxed");
    }

    // Initialize by setting the currentTime to 0
    this.video.currentTime = 0;
  }

  checkShouldResolve(frameNumber: number) {
    if (
      this.decodedFrames[frameNumber] &&
      frameNumber === this.requestedFrameIndex
    ) {
      console.log("Resolving requestedFrameIndex:", this.requestedFrameIndex);
      this.decodeResolver!(this.decodedFrames[frameNumber]);
    }
  }

  async parseVideo(url: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Fetch the file from the URL
        console.log("fetching", url);
        let response: Response;
        try {
          response = await fetch(url);
        } catch (e) {
          console.error("Failed to fetch file:", e);
          reject(e);
          return;
        }

        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        // Read the response as an ArrayBuffer
        const arrayBuffer = await response.arrayBuffer();
        const blob = new Blob([arrayBuffer]);
        const frameDecodedHandler = async (frame: VideoFrame) => {
          const frameNumber = Math.ceil(
            (frame.timestamp / 1_000_000) * this.fps,
          );
          this.decodedFrames[frameNumber] = frame;
          this.checkShouldResolve(frameNumber);
        };
        const demuxer: LibAVDemuxer = new LibAVDemuxer();
        const result = await demuxer.start({
          file: blob,
          frameDecodedHandler,
        });

        const { chunks, config, videoStream, decoders } = result;
        //const timescale = videoStream.time_base_den;
        const duration = videoStream.duration;
        const frameCount = chunks.length;
        const fps = frameCount / duration;

        this.videoDecoder = decoders[0];
        console.log("Demuxed", result);
        console.log("FPS:", fps);
        console.log("Frame count:", frameCount);
        console.log("Duration:", duration);

        this.samples = chunks;

        this.canvas = new OffscreenCanvas(
          config.codedWidth!,
          config.codedHeight!,
        );

        this.fps = fps;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }
}
