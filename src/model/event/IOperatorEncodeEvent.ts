import * as apid from '../../../api';

/**
 * 追加されたビデオファイル情報
 */
export interface OperatorFinishEncodeInfo {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId | null;
    videoFileIds: apid.VideoFileId[];
    mode: string; // エンコードモード名
    inputPath: string;
    inputVideoFileDisplayName: string; // VideoFile.name の値（実ファイル名ではない）
    inputVideoFileType: apid.VideoFileType;
}

export default interface IOperatorEncodeEvent {
    emitFinishEncode(info: OperatorFinishEncodeInfo): void;
    setFinishEncode(callback: (info: OperatorFinishEncodeInfo) => void): void;
}
