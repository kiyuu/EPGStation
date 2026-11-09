import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import IEncodeEvent, { FinishEncodeInfo } from '../../event/IEncodeEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IIPCClient from '../../ipc/IIPCClient';
import ISocketIOManageModel from '../socketio/ISocketIOManageModel';
import { AddVideoFileOption } from '../../operator/recorded/IRecordedManageModel';
import IEncodeFinishModel from './IEncodeFinishModel';
import EncodeOutputUtil from './EncodeOutputUtil';

@injectable()
export default class EncodeFinishModel implements IEncodeFinishModel {
    private log: ILogger;
    private socket: ISocketIOManageModel;
    private ipc: IIPCClient;
    private encodeEvent: IEncodeEvent;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISocketIOManageModel') socket: ISocketIOManageModel,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
    ) {
        this.log = logger.getLogger();
        this.socket = socket;
        this.ipc = ipc;
        this.encodeEvent = encodeEvent;
    }

    public set(): void {
        this.encodeEvent.setAddEncode(this.addEncode.bind(this));
        this.encodeEvent.setCancelEncode(this.cancelEncode.bind(this));
        this.encodeEvent.setFinishEncode(this.finishEncode.bind(this));
        this.encodeEvent.setErrorEncode(this.errorEncode.bind(this));
        this.encodeEvent.setUpdateEncodeProgress(this.updateEncodeProgress.bind(this));
    }

    /**
     * エンコード追加処理
     * @param encodeId
     */
    private addEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコードキャンセル処理
     * @param encodeId
     */
    private cancelEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード終了処理
     * @param info: FinishEncodeInfo
     */
    private async finishEncode(info: FinishEncodeInfo): Promise<void> {
        let newVideoFileIds: apid.VideoFileId[] = [];
        try {
            if (info.fullOutputPath === null || info.filePath === null) {
                // update file size
                await this.ipc.recorded.updateVideoFileSize(info.videoFileId);
            } else {
                const outputSet = await EncodeOutputUtil.resolveEncodeOutputSet(
                    info.inputPath,
                    info.inputVideoFileType,
                    info.inputVideoFileDisplayName,
                    info.fullOutputPath,
                );
                if (outputSet?.kind === 'single') {
                    // 通常出力が存在する場合は現行の単一ファイル登録経路を使う。
                    const id = await this.ipc.recorded.addVideoFile({
                        recordedId: info.recordedId,
                        parentDirectoryName: info.parentDirName,
                        filePath: info.filePath,
                        type: 'encoded',
                        name: info.mode,
                    });
                    newVideoFileIds = [id];
                } else if (outputSet?.kind === 'split') {
                    const relativeDirectory = path.dirname(info.filePath);
                    const options: AddVideoFileOption[] = outputSet.paths.map((outputPath, index) => ({
                        recordedId: info.recordedId,
                        parentDirectoryName: info.parentDirName,
                        filePath: path.join(relativeDirectory, path.basename(outputPath)),
                        type: 'encoded',
                        name: `${info.mode}_div${index + 1}`,
                    }));
                    newVideoFileIds = await this.ipc.recorded.addVideoFiles(options);
                } else {
                    // 欠落・余分・不正な分割出力は部分登録せず、現行の無出力時処理を維持する。
                    await this.ipc.recorded.updateVideoFileSize(info.videoFileId);
                }
            }
        } catch (err: any) {
            this.log.encode.error('finish encode error');
            this.log.encode.error(err);
        }

        if (info.removeOriginal === true) {
            // delete source video file
            await this.ipc.recorded.deleteVideoFile(info.videoFileId, true);
        }

        this.socket.notifyClient();

        // Operator にイベントを転送
        await this.ipc.encodeEvent.emitFinishEncode({
            recordedId: info.recordedId,
            videoFileId: newVideoFileIds[0] ?? null,
            videoFileIds: newVideoFileIds,
            mode: info.mode,
            inputPath: info.inputPath,
            inputVideoFileDisplayName: info.inputVideoFileDisplayName,
            inputVideoFileType: info.inputVideoFileType,
        });
    }

    /**
     * エンコード失敗処理
     */
    private errorEncode(): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード進捗情報更新
     */
    private updateEncodeProgress(): void {
        this.socket.notifyUpdateEncodeProgress();
    }
}
