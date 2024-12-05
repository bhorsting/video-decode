import * as LibAV from "@libav.js/variant-webcodecs";
import {
  packetToEncodedVideoChunk,
  videoStreamToConfig,
} from "../web-codecs-bridge/demux.ts";
import {
  configToVideoStream,
  encodedVideoChunkToPacket,
} from "../web-codecs-bridge/mux.ts";
import { BufferStream } from "../buffer-stream/BufferStream.ts";

type PacketToChunkType = typeof packetToEncodedVideoChunk;

export type DemuxResult = {
  chunks: EncodedVideoChunk[];
  decoders: VideoDecoder[];
};

export class LibAVDemuxer {
  private chunks: EncodedVideoChunk[] = [];
  private decoders: VideoDecoder[] = [];
  constructor() {}
  async start({
    videoCodec,
    file,
    frameDecodedHandler,
  }: {
    videoCodec: string;
    file: Blob;
    frameDecodedHandler: (frame: VideoFrame) => Promise<void>;
  }) {
    /* Prepare libav. We're using noworker here because libav is
     * loaded from a different origin, but you should simply
     * load libav from the same origin! */

    this.chunks = [];
    this.decoders = [];

    const libav = await LibAV.LibAV({ noworker: true });
    await libav.mkreadaheadfile("input", file);

    // Start demuxer
    const [ifc, istreams] = await libav.ff_init_demuxer_file("input");
    const rpkt = await libav.av_packet_alloc();

    // Translate all the streams
    const iToO: number[] = [];
    const decConfigs = [];
    const packetToChunks: PacketToChunkType[] = [];
    const encoders = [];
    const encoderStreams = [];
    const encoderReaders = [];
    const encConfigs = [];
    const chunkToPackets = [];
    const ostreams = [];

    // Find video stream
    const istream = istreams.find(
      (istream) => istream.codec_type === libav.AVMEDIA_TYPE_VIDEO,
    );

    if (!istream) {
      throw new Error("No video stream found!");
    }

    for (let streamI = 0; streamI < istreams.length; streamI++) {
      const istream = istreams[streamI];
      iToO.push(-1);
      let streamToConfig,
        Decoder,
        packetToChunk,
        configToStream,
        Encoder,
        chunkToPacket;
      if (istream.codec_type === libav.AVMEDIA_TYPE_VIDEO) {
        streamToConfig = videoStreamToConfig;
        Decoder = VideoDecoder;
        packetToChunk = packetToEncodedVideoChunk;
        configToStream = configToVideoStream;
        Encoder = VideoEncoder;
        chunkToPacket = encodedVideoChunkToPacket;
      } else {
        continue;
      }

      // Convert the config
      const config = await streamToConfig(libav, istream);
      console.log("Config", config);
      let supported;
      try {
        supported = await Decoder.isConfigSupported(config);
      } catch (ex) {}
      if (!supported || !supported.supported) continue;
      console.log("Supported", supported);
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

      // Make the encoder config
      const encConfig = {
        codec: videoCodec,
        width: config.codedWidth,
        height: config.codedHeight,
        numberOfChannels: config.numberOfChannels,
        sampleRate: config.sampleRate,
      };
      encConfigs.push(encConfig);

      // Make the encoder
      const encStream = new BufferStream();
      encoderStreams.push(encStream);
      encoderReaders.push(encStream.getReader());
      const encoder = new Encoder({
        output: (chunk, metadata) => encStream.push({ chunk, metadata }),
        error: (error) =>
          alert("Encoder " + JSON.stringify(encConfig) + ":\n" + error),
      });
      encoder.configure(encConfig);
      encoders.push(encoder);
      chunkToPackets.push(chunkToPacket);

      // Make the output stream
      ostreams.push(await configToStream(libav, encConfig));
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

        for (const idx in packets) {
          if (iToO[idx] < 0) continue;
          const o = iToO[idx];
          const dec = this.decoders[o];
          console.log("decoder", dec);
          const p2c = packetToChunks[o];
          for (const packet of packets[idx]) {
            const chunk: EncodedVideoChunk = p2c(packet, istreams[idx]);
            console.log("chunk", chunk);
            this.chunks.push(chunk);
          }
        }

        if (res === libav.AVERROR_EOF) break;
      }
      for (let i = 0; i < this.decoders.length; i++) {
        await this.decoders[i].flush();
        this.decoders[i].close();
      }
      console.log("Done");
      return { chunks: this.chunks, decoders: this.decoders };
    };
    return await demux();
  }
}
