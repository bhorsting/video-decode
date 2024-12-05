import { VideoFrameExtractor } from "./VideoFrameExtractor.ts";

export const parseAllVideos = (videos: NodeListOf<HTMLVideoElement>) => {
  videos.forEach(async (video) => {
    console.log("Parsing video:", video.src);
    const videoFrameExtractor: VideoFrameExtractor = new VideoFrameExtractor(
      video,
    );
    await videoFrameExtractor.start();
    console.log("Video parsed:", video.src);
  });
};
