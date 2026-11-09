import type { OperatorFinishEncodeInfo } from '../../event/IOperatorEncodeEvent';

export const createOutputEnv = (
    info: OperatorFinishEncodeInfo,
    outputPath: string | null,
): { [name: string]: string | number | null } => {
    const videoFileIds = info.videoFileIds ?? (info.videoFileId === null ? [] : [info.videoFileId]);
    const firstVideoFileId = videoFileIds[0] ?? null;

    return {
        RECORDEDID: info.recordedId,
        VIDEOFILEID: firstVideoFileId === null ? '' : firstVideoFileId,
        VIDEOFILEIDS: JSON.stringify(videoFileIds),
        OUTPUTPATH: outputPath,
        INPUT: info.inputPath,
        INPUTVIDEOFILE_NAME: info.inputVideoFileDisplayName,
        INPUTVIDEOFILE_TYPE: info.inputVideoFileType,
    };
};

const EncodeFinishEnvUtil = { createOutputEnv };
export default EncodeFinishEnvUtil;
