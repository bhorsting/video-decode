import MP4Box, { MP4ArrayBuffer } from "mp4box";
import DataStream from "./datastream/DataStream.ts";

export class VideoFrameExtractor {
  private video: HTMLVideoElement;
  private fps: number = 0;
  private decodedFrames: VideoFrame[] = [];
  private canvas: OffscreenCanvas | null = null;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start() {
    this.decodedFrames = [];
    await this.parseVideo(this.video.src);
    console.log("FPS:", this.fps);
    this.replaceVideoWithImage();
  }

  replaceVideoWithImage() {
    let i;
    if (!this.video) {
      throw new Error("Video element not found");
    }
    if (this.decodedFrames.length === 0) {
      throw new Error("No frames decoded");
    }
    // Create a new image element
    const imgElement = document.createElement("img");

    // Copy attributes from video element to image element, excluding src
    const attrs = this.video.attributes;
    for (i = 0; i < attrs.length; i++) {
      var attr = attrs[i];
      if (attr.name !== "src") {
        imgElement.setAttribute(attr.name, attr.value);
      }
    }

    // Copy class list
    imgElement.className = this.video.className;

    // Copy id
    imgElement.id = this.video.id;

    // Copy inline styles
    imgElement.style.cssText = this.video.style.cssText;

    // Copy computed styles to ensure all CSS properties and painting are the same
    const computedStyle = window.getComputedStyle(this.video);
    for (i = 0; i < computedStyle.length; i++) {
      var prop = computedStyle[i];
      // @ts-ignore
      imgElement.style[prop] = computedStyle.getPropertyValue(prop);
    }

    const self = this;
    // Create a handler for currentTime
    Object.defineProperty(imgElement, "currentTime", {
      get: function () {
        // Implement getter as needed
        return this._currentTime || 0;
      },
      set: async function (value) {
        console.log("Setting currentTime:", value);
        // Fetch the frame from the cache
        const frameIndex = Math.floor(value * self.fps);
        const frame: VideoFrame = self.decodedFrames[frameIndex];
        if (!frame) {
          console.error("Frame not found:", frameIndex);
          return;
        }
        const ctx = self.canvas!.getContext("2d");
        ctx!.drawImage(frame, 0, 0);

        self.canvas!.convertToBlob({ type: "image/png" }).then((blob) => {
          const url = URL.createObjectURL(blob!);
          this.src = url;
        });

        console.log("Setting currentTime:", value);
        this._currentTime = value;
      },
      configurable: true,
      enumerable: true,
    });

    // Replace the video element with the image element in the DOM
    this.video!.parentNode!.replaceChild(imgElement, this.video);
    (imgElement as any).currentTime = 0;
  }

  handleDecodedFrame(frame: VideoFrame) {
    this.decodedFrames.push(frame);
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
        mp4boxFile.onReady = (info) => {
          // Find the video track
          console.log("info:", info);
          const videoTrack = info.tracks.find((track) => track.movie_duration);
          console.log("Video track:", videoTrack);
          if (videoTrack) {
            const timescale = videoTrack.timescale;
            const duration = videoTrack.duration; // in timescale units
            const frameCount = videoTrack.nb_samples;
            const fps = frameCount / (duration / timescale);

            const videoDecoder = new VideoDecoder({
              output: (frame) => this.handleDecodedFrame(frame),
              error: (error) => console.error("Decoding error:", error),
            });

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
                videoDecoder.decode(
                  new EncodedVideoChunk({
                    type: sample.is_sync ? "key" : "delta",
                    timestamp: (sample.cts * 1_000_000) / sample.timescale,
                    duration: (sample.duration * 1_000_000) / sample.timescale,
                    data: sample.data,
                  }),
                );
              }
              await videoDecoder.flush();
              videoDecoder.close();
              mp4boxFile.flush();
              console.log(
                "Demux complete, created",
                samples.length,
                "frames encode requests",
              );
              resolve();
            };
            mp4boxFile.setExtractionOptions(videoTrack.id, videoTrack, {
              nbSamples: Infinity,
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
