import * as path from 'path';
import { readFile, readdir, stat } from 'fs/promises';

export interface EncodeOutputSet {
    kind: 'single' | 'split';
    paths: string[];
}

/**
 * 入力に対応する録画 TS の div.txt を返す。
 * EPGStation の VideoFile.name は実ファイル名ではないため、分割片かどうかは
 * VideoFile の type/name と INPUT の basename を合わせて判定する。
 */
export const getDivisionSidecarPath = (
    inputPath: string,
    inputVideoFileType: string,
    inputVideoFileName: string,
): string => {
    if (inputVideoFileType === 'ts') {
        return `${inputPath}.div.txt`;
    }

    const parsed = path.parse(inputPath);
    const baseName = isConfirmedSplitInput(inputPath, inputVideoFileType, inputVideoFileName)
        ? parsed.name.replace(/_div[1-9]\d*$/, '')
        : parsed.name;

    return path.join(parsed.dir, `${baseName}.ts.div.txt`);
};

export const isConfirmedSplitInput = (
    inputPath: string,
    inputVideoFileType: string,
    inputVideoFileName: string,
): boolean => {
    if (inputVideoFileType === 'ts') {
        return false;
    }

    const inputSplitMatch = path.parse(inputPath).name.match(/_div([1-9]\d*)$/);
    const metadataSplitMatch = inputVideoFileName.match(/_div([1-9]\d*)$/);
    return inputSplitMatch !== null && metadataSplitMatch !== null && inputSplitMatch[1] === metadataSplitMatch[1];
};

/**
 * Amatsukaze が書く div.txt の内部境界数を返す。
 * 不正な値・重複・昇順でない境界は、分割出力を安全に確定できないため null。
 */
export const parseDivisionPointCount = (content: string): number | null => {
    const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
    const points: number[] = [];

    for (const line of lines) {
        const value = line.trim();
        if (value.length === 0) {
            continue;
        }

        if (!/^(0|[1-9]\d*)$/.test(value)) {
            return null;
        }

        const point = Number(value);
        if (!Number.isSafeInteger(point) || point <= 0) {
            return null;
        }
        if (points.length > 0 && point <= points[points.length - 1]) {
            return null;
        }

        points.push(point);
    }

    return points.length;
};

/**
 * 通常出力が無いとき、期待数と完全一致する _divN 出力一式だけを返す。
 * 欠番・余分な番号・非ファイルがあれば部分登録を防ぐため null。
 */
export const findCompleteSplitOutputPaths = async (
    outputFilePath: string,
    expectedCount: number,
): Promise<string[] | null> => {
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 1) {
        return null;
    }

    const parsed = path.parse(outputFilePath);
    const splitPattern = new RegExp(`^${escapeRegExp(parsed.name)}_div(\\d+)${escapeRegExp(parsed.ext)}$`);
    const fileNames = await readdir(parsed.dir).catch(() => null);
    if (fileNames === null) {
        return null;
    }

    const splitNames = fileNames.filter(name => splitPattern.test(name));
    if (splitNames.length !== expectedCount) {
        return null;
    }

    const result: string[] = [];
    for (let index = 1; index <= expectedCount; index++) {
        const fileName = `${parsed.name}_div${index}${parsed.ext}`;
        if (!splitNames.includes(fileName)) {
            return null;
        }

        const filePath = path.join(parsed.dir, fileName);
        const stats = await stat(filePath).catch(() => null);
        if (stats === null || !stats.isFile()) {
            return null;
        }

        result.push(filePath);
    }

    return result;
};

export const resolveEncodeOutputSet = async (
    inputPath: string,
    inputVideoFileType: string,
    inputVideoFileName: string,
    outputFilePath: string,
): Promise<EncodeOutputSet | null> => {
    const outputStats = await stat(outputFilePath).catch(() => null);
    if (outputStats !== null && outputStats.isFile()) {
        return { kind: 'single', paths: [outputFilePath] };
    }

    const sidecarPath = getDivisionSidecarPath(inputPath, inputVideoFileType, inputVideoFileName);
    const sidecar = await readFile(sidecarPath, 'utf-8').catch(() => null);
    const divisionPointCount = sidecar === null ? null : parseDivisionPointCount(sidecar);
    if (divisionPointCount === null) {
        return null;
    }

    const splitPaths = await findCompleteSplitOutputPaths(outputFilePath, divisionPointCount + 1);
    return splitPaths === null ? null : { kind: 'split', paths: splitPaths };
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const EncodeOutputUtil = {
    getDivisionSidecarPath,
    isConfirmedSplitInput,
    parseDivisionPointCount,
    findCompleteSplitOutputPaths,
    resolveEncodeOutputSet,
};
export default EncodeOutputUtil;
