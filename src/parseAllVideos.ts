import { VideoFrameExtractor } from "./VideoFrameExtractor.ts";

export const parseAllVideos = (videos: NodeListOf<HTMLVideoElement>) => {
  videos.forEach((video) => {
    const videoFrameExtractor: VideoFrameExtractor = new VideoFrameExtractor(
      video,
    );
    videoFrameExtractor.start();
  });
};
