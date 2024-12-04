import MP4Box, { MP4ArrayBuffer } from "mp4box";
import DataStream from "./datastream/DataStream.ts";

export class VideoFrameExtractor {
  private video: HTMLVideoElement;
  private fps: number = 0;
  private frameCount: number = 0;
  private decodedFrames: VideoFrame[] = [];
  private canvas: OffscreenCanvas | null = null;
  private videoDecoder: VideoDecoder | undefined;
  private mp4boxFile: MP4Box.MP4File | undefined;
  private samples: any[] = [];

  private decodeResolver?: (value: VideoFrame) => void;
  private decodePromise?: Promise<VideoFrame>;
  private requestedFrameIndex: number = Infinity;

  constructor(video: HTMLVideoElement) {
    this.video = video;
    this.decodePromise = new Promise<VideoFrame>((resolve) => {
      this.decodeResolver = resolve;
    });
  }

  async start() {
    this.decodedFrames = [];
    this.samples = [];
    await this.parseVideo(this.video.src);
    console.log("FPS:", this.fps);
    this.replaceVideoWithImage();
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
    const sample = this.samples[sampleIndex];
    this.videoDecoder!.decode(
      new EncodedVideoChunk({
        type: sample.is_sync ? "key" : "delta",
        timestamp: (sample.cts * 1_000_000) / sample.timescale,
        duration: (sample.duration * 1_000_000) / sample.timescale,
        data: sample.data,
      }),
    );
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

    const self = this;

    // Create a handler for currentTime
    Object.defineProperty(this.video, "currentTime", {
      get: function () {
        // Return the stored _currentTime
        return this._currentTime || 0;
      },
      set: async function (value) {
        console.log("Setting currentTime:", value);

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
      },
      configurable: true,
      enumerable: true,
    });

    // Initialize by setting the currentTime to 0
    this.video.currentTime = 0;
  }

  checkShouldResolve(frameNumber: number) {
    if (
      this.decodedFrames[frameNumber] &&
      frameNumber === this.requestedFrameIndex
    ) {
      this.decodeResolver!(this.decodedFrames[frameNumber]);
    }
  }

  async parseVideo(url: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Fetch the file from the URL
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        // Read the response as an ArrayBuffer
        const arrayBuffer = await response.arrayBuffer();

        // Create a new mp4box file instance
        const mp4boxFile = MP4Box.createFile();
        this.mp4boxFile = mp4boxFile;
        mp4boxFile.onReady = (info) => {
          // Find the video track
          const videoTrack = info.tracks.find((track) => track.movie_duration);
          if (videoTrack) {
            const timescale = videoTrack.timescale;
            const duration = videoTrack.duration; // in timescale units
            const frameCount = videoTrack.nb_samples;
            this.frameCount = frameCount;
            const fps = frameCount / (duration / timescale);

            const handleDecodedFrame = async (frame: VideoFrame) => {
              const frameNumber = Math.ceil(
                (frame.timestamp / 1_000_000) * this.fps,
              );
              this.decodedFrames[frameNumber] = frame;
              this.checkShouldResolve(frameNumber);
            };

            const videoDecoder = new VideoDecoder({
              output: (frame) => handleDecodedFrame(frame),
              error: (error) => {
                console.error("Decoding error:", error);
              },
            });

            this.videoDecoder = videoDecoder;

            let description: Uint8Array | undefined;
            const trak = mp4boxFile.getTrackById(videoTrack.id);
            for (const entry of trak.mdia.minf.stbl.stsd.entries) {
              if (entry.avcC || entry.hvcC) {
                const stream = new DataStream(
                  undefined,
                  0,
                  DataStream.BIG_ENDIAN,
                );
                if (entry.avcC) {
                  entry.avcC.write(stream);
                } else {
                  entry.hvcC.write(stream);
                }
                description = new Uint8Array(stream.buffer, 8); // Remove the box header.
                break;
              }
            }

            videoDecoder.configure({
              codec: videoTrack.codec,
              codedWidth: videoTrack.track_width,
              codedHeight: videoTrack.track_height,
              description,
            });

            this.canvas = new OffscreenCanvas(
              videoTrack.track_width,
              videoTrack.track_height,
            );

            mp4boxFile.onSamples = async (id, user, samples) => {
              console.log("Demuxing", samples.length, "frames");
              for (const sample of samples) {
                this.samples.push(sample);
              }
              if (this.samples.length === frameCount) {
                console.log("All samples demuxed");
                resolve();
              }
            };
            mp4boxFile.setExtractionOptions(videoTrack.id, videoTrack, {
              nbSamples: 100,
            });
            mp4boxFile.start();
            this.fps = fps;
          } else {
            reject("No video track found.");
          }
        };

        // Convert ArrayBuffer to MP4Box format
        const mp4Buffer = arrayBuffer as MP4ArrayBuffer;
        mp4Buffer.fileStart = 0;

        // Append the buffer to the mp4box file
        mp4boxFile.appendBuffer(mp4Buffer);
      } catch (error) {
        reject(error);
      }
    });
  }
}
