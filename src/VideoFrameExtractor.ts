import MP4Box, {MP4ArrayBuffer} from 'mp4box';
import DataStream from "./datastream/DataStream.ts";

export class VideoFrameExtractor {
    private video: HTMLVideoElement;
    private frameCache: Map<number, ImageBitmap>;
    private fps: number;
    constructor(video: HTMLVideoElement) {
        this.video = video;
        this.frameCache = new Map();

    }
    async start () {
        this.fps = await this.parseVideo(this.video.src);
        console.log('FPS:', this.fps);
    }
    async getFrameAtTime(time: number): Promise<ImageBitmap> {
        const frameIndex = Math.floor(time * this.fps);
        if (this.frameCache.has(frameIndex)) {
            return this.frameCache.get(frameIndex)!;
        }
        const frame = await this.decodeFrame(frameIndex);
        this.frameCache.set(frameIndex, frame);
        return frame;
    }

    handleDecodedFrame = (frame: VideoFrame) => {
        console.log('Decoded frame:', frame);
    }

    async parseVideo(url: string): Promise<number> {
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
                mp4boxFile.onReady =  (info) => {
                    // Find the video track
                    console.log('info:', info);
                    const videoTrack = info.tracks.find(track => track.movie_duration);
                    console.log('Video track:', videoTrack);
                    if (videoTrack) {
                        const timescale = videoTrack.timescale;
                        const duration = videoTrack.duration; // in timescale units
                        const frameCount = videoTrack.nb_samples;
                        const fps = frameCount / (duration / timescale);

                        const videoDecoder = new VideoDecoder({
                            output: (frame) => this.handleDecodedFrame (frame),
                            error: (error) => console.error('Decoding error:', error),
                        });

                        let description: Uint8Array | undefined;
                        const trak = mp4boxFile.getTrackById(videoTrack.id);
                        for (const entry of trak.mdia.minf.stbl.stsd.entries) {
                            if (entry.avcC || entry.hvcC) {
                                const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
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

                        mp4boxFile.onSamples = async (id, user, samples) => {
                            for (const sample of samples) {
                                videoDecoder.decode(new EncodedVideoChunk({
                                    type: sample.is_sync ? "key" : "delta",
                                    timestamp: sample.cts * 1_000_000 / sample.timescale,
                                    duration: sample.duration * 1_000_000 / sample.timescale,
                                    data: sample.data
                                }));
                            }
                            await videoDecoder.flush();
                        };
                        mp4boxFile.setExtractionOptions(videoTrack.id, videoTrack);
                        mp4boxFile.start();

                        resolve(fps);
                    } else {
                        reject('No video track found.');
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
