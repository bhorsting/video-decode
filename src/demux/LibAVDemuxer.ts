import {
  packetToEncodedVideoChunk,
  videoStreamToConfig,
} from "../web-codecs-bridge/demux.ts";
// @ts-ignore
import * as LibAV from "../@libav.js/variant-webcodecs/dist/libav-6.4.7.1-webcodecs";
import { Stream } from "../@libav.js/variant-webcodecs/dist/libav.types";

type PacketToChunkType = typeof packetToEncodedVideoChunk;

export type DemuxResult = {
  chunks: EncodedVideoChunk[];
  decoders: VideoDecoder[];
  videoStream: Stream;
  config: VideoDecoderConfig;
};

export class LibAVDemuxer {
  private chunks: EncodedVideoChunk[] = [];
  private decoders: VideoDecoder[] = [];
  constructor() {}
  async start({
    file,
    frameDecodedHandler,
  }: {
    file: Blob;
    frameDecodedHandler: (frame: VideoFrame) => Promise<void>;
  }) {
    this.chunks = [];
    this.decoders = [];

    const libav = await LibAV.LibAV({ noworker: false });
    await libav.mkreadaheadfile("input", file);

    // Start demuxer
    const [ifc, istreams]: [ifc: number, istreams: Stream[]] =
      await libav.ff_init_demuxer_file("input");
    const rpkt = await libav.av_packet_alloc();

    // Translate all the streams
    const iToO: any = [];
    const decConfigs = [];
    const packetToChunks: PacketToChunkType[] = [];
    let config: VideoDecoderConfig;
    // Find video stream
    const istream: Stream | undefined = istreams.find(
      (istream: Stream) => istream.codec_type === libav.AVMEDIA_TYPE_VIDEO,
    );

    if (!istream) {
      throw new Error("No video stream found!");
    }

    console.log("Stream", istream);

    for (let streamI = 0; streamI < istreams.length; streamI++) {
      const istream = istreams[streamI];
      iToO.push(-1);
      let streamToConfig, Decoder, packetToChunk;
      if (istream.codec_type === libav.AVMEDIA_TYPE_VIDEO) {
        streamToConfig = videoStreamToConfig;
        Decoder = VideoDecoder;
        packetToChunk = packetToEncodedVideoChunk;
      } else {
        continue;
      }

      // Convert the config
      config = await streamToConfig(libav, istream);
      console.log("Config", config);
      let supported;
      try {
        supported = await Decoder.isConfigSupported(config);
      } catch (ex) {
        throw new Error(
          "Decoder does not support config:" +
            JSON.stringify(config) +
            ":\n" +
            ex,
        );
      }
      if (!supported || !supported.supported) continue;
      iToO[streamI] = decConfigs.length;
      decConfigs.push(config);

      // Make the decoder
      const decoder = new Decoder({
        output: frameDecodedHandler,
        error: (error) =>
          alert("Decoder " + JSON.stringify(config) + ":\n" + error),
      });
      decoder.configure(config);
      this.decoders.push(decoder);
      packetToChunks.push(packetToChunk);
    }

    if (!this.decoders.length) throw new Error("No decodable streams found!");

    // Demuxer -> decoder
    const demux = async (): Promise<DemuxResult> => {
      while (true) {
        const [res, packets] = await libav.ff_read_frame_multi(ifc, rpkt, {
          limit: 1,
        });
        if (res !== -libav.EAGAIN && res !== 0 && res !== libav.AVERROR_EOF)
          break;

        for (const idx of Object.keys(packets)) {
          if (iToO[idx] < 0) continue;
          const o = iToO[idx];
          const p2c = packetToChunks[o];
          for (const packet of packets[idx]) {
            const chunk: EncodedVideoChunk = p2c(packet, istreams[idx]);
            this.chunks.push(chunk);
          }
        }

        if (res === libav.AVERROR_EOF) break;
      }
      for (let i = 0; i < this.decoders.length; i++) {
        await this.decoders[i].flush();
      }
      console.log("Done");
      return {
        chunks: this.chunks,
        decoders: this.decoders,
        videoStream: istream,
        config,
      };
    };
    return await demux();
  }
}
