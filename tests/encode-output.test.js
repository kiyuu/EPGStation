const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
require('reflect-metadata');

const EncodeOutputUtil = require('../dist/model/service/encode/EncodeOutputUtil').default;
const EncodeFileManageModel = require('../dist/model/service/encode/EncodeFileManageModel').default;
const EncodeFinishModel = require('../dist/model/service/encode/EncodeFinishModel').default;
const EncodeFinishEnvUtil = require('../dist/model/operator/externalCommand/EncodeFinishEnvUtil').default;
const VideoFileDB = require('../dist/model/db/VideoFileDB').default;

let tempDirectory;

const noRetry = { run: job => job() };

async function createTempDirectory() {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'epgstation-encode-output-'));
    return tempDirectory;
}

test.afterEach(async () => {
    if (tempDirectory !== undefined) {
        await fs.rm(tempDirectory, { recursive: true, force: true });
        tempDirectory = undefined;
    }
});

test('parses canonical internal division points and rejects malformed lists', () => {
    assert.equal(EncodeOutputUtil.parseDivisionPointCount('\uFEFF10\r\n\r\n20\r\n'), 2);
    assert.equal(EncodeOutputUtil.parseDivisionPointCount(''), 0);
    assert.equal(EncodeOutputUtil.parseDivisionPointCount('10\n10'), null);
    assert.equal(EncodeOutputUtil.parseDivisionPointCount('20\n10'), null);
    assert.equal(EncodeOutputUtil.parseDivisionPointCount('0'), null);
    assert.equal(EncodeOutputUtil.parseDivisionPointCount('01'), null);
    assert.equal(EncodeOutputUtil.parseDivisionPointCount('# boundary'), null);
});

test('resolves the sidecar from INPUT and only strips a confirmed encoded split suffix', () => {
    const inputPath = path.join('recorded', 'show_div1.mkv');
    assert.equal(
        EncodeOutputUtil.getDivisionSidecarPath(inputPath, 'encoded', 'H.264_div1'),
        path.join('recorded', 'show.ts.div.txt'),
    );
    assert.equal(
        EncodeOutputUtil.getDivisionSidecarPath(path.join('recorded', 'show_div1.ts'), 'ts', 'TS'),
        path.join('recorded', 'show_div1.ts.div.txt'),
    );
    assert.equal(
        EncodeOutputUtil.getDivisionSidecarPath(path.join('recorded', 'show.TS'), 'ts', 'TS'),
        path.join('recorded', 'show.TS.div.txt'),
    );
    assert.equal(
        EncodeOutputUtil.getDivisionSidecarPath(path.join('recorded', 'show_div2.mkv'), 'encoded', 'H.264_div1'),
        path.join('recorded', 'show_div2.ts.div.txt'),
    );
});

test('accepts only a complete, exact _div1..N file set', async () => {
    const dir = await createTempDirectory();
    const outputPath = path.join(dir, 'show.mp4');
    await fs.writeFile(path.join(dir, 'show_div1.mp4'), 'one');
    await fs.writeFile(path.join(dir, 'show_div2.mp4'), 'two');

    assert.deepEqual(await EncodeOutputUtil.findCompleteSplitOutputPaths(outputPath, 2), [
        path.join(dir, 'show_div1.mp4'),
        path.join(dir, 'show_div2.mp4'),
    ]);

    await fs.writeFile(path.join(dir, 'show_div3.mp4'), 'extra');
    assert.equal(await EncodeOutputUtil.findCompleteSplitOutputPaths(outputPath, 2), null);
});

test('allocator ignores different sibling paths, protects exact collisions, and reserves concurrent duplicates', async () => {
    const dir = await createTempDirectory();
    const allocator = new EncodeFileManageModel();
    await fs.writeFile(path.join(dir, 'stale_div1.mp4'), 'stale');

    assert.equal(await allocator.getFilePath(dir, 'stale.ts', '.mp4'), path.join(dir, 'stale.mp4'));

    await fs.writeFile(path.join(dir, 'exact.mp4'), 'exact');
    assert.equal(await allocator.getFilePath(dir, 'exact.ts', '.mp4'), path.join(dir, 'exact(1).mp4'));

    const concurrentAllocator = new EncodeFileManageModel();
    const paths = await Promise.all([
        concurrentAllocator.getFilePath(dir, 'parallel.ts', '.mp4'),
        concurrentAllocator.getFilePath(dir, 'parallel.ts', '.mp4'),
    ]);
    assert.deepEqual(new Set(paths), new Set([path.join(dir, 'parallel.mp4'), path.join(dir, 'parallel(1).mp4')]));
});
function createFinishModel(calls, ids = [101, 102, 103]) {
    const logger = {
        getLogger: () => ({ encode: { error: (...args) => calls.push(['log', ...args]) } }),
    };
    const socket = { notifyClient: () => calls.push(['notify']) };
    const ipc = {
        recorded: {
            updateVideoFileSize: async id => calls.push(['update-size', id]),
            addVideoFile: async option => {
                calls.push(['add-one', option]);
                return ids[0];
            },
            addVideoFiles: async options => {
                calls.push(['add-many', options]);
                return ids.slice(0, options.length);
            },
            deleteVideoFile: async (id, ignoreProtection) => calls.push(['delete-input', id, ignoreProtection]),
        },
        encodeEvent: {
            emitFinishEncode: async info => calls.push(['finish-event', info]),
        },
    };
    return new EncodeFinishModel(logger, socket, ipc, {});
}

function createFinishInfo(dir, overrides = {}) {
    return {
        recordedId: 7,
        videoFileId: 9,
        parentDirName: 'recorded',
        filePath: 'show.mp4',
        fullOutputPath: path.join(dir, 'show.mp4'),
        mode: 'H.264',
        removeOriginal: true,
        inputPath: path.join(dir, 'show.ts'),
        inputVideoFileDisplayName: 'TS',
        inputVideoFileType: 'ts',
        ...overrides,
    };
}

test('registers a complete split set before deleting input and emits one finish event', async () => {
    const dir = await createTempDirectory();
    await fs.writeFile(path.join(dir, 'show.ts.div.txt'), '10\n20\n');
    await fs.writeFile(path.join(dir, 'show_div1.mp4'), 'one');
    await fs.writeFile(path.join(dir, 'show_div2.mp4'), 'two');
    await fs.writeFile(path.join(dir, 'show_div3.mp4'), 'three');
    const calls = [];

    await createFinishModel(calls).finishEncode(createFinishInfo(dir));

    assert.deepEqual(
        calls.map(call => call[0]),
        ['add-many', 'delete-input', 'notify', 'finish-event'],
    );
    assert.deepEqual(
        calls[0][1].map(option => [option.filePath, option.name, option.type]),
        [
            ['show_div1.mp4', 'H.264_div1', 'encoded'],
            ['show_div2.mp4', 'H.264_div2', 'encoded'],
            ['show_div3.mp4', 'H.264_div3', 'encoded'],
        ],
    );
    assert.deepEqual(calls[3][1].videoFileIds, [101, 102, 103]);
    assert.equal(calls[3][1].videoFileId, 101);
    assert.equal(calls[3][1].inputPath, path.join(dir, 'show.ts'));
    assert.equal(calls[3][1].inputVideoFileDisplayName, 'TS');
    assert.equal(calls[3][1].inputVideoFileType, 'ts');
});

test('does not partially register incomplete split output and keeps the existing no-output path', async () => {
    const dir = await createTempDirectory();
    await fs.writeFile(path.join(dir, 'show.ts.div.txt'), '10\n20\n');
    await fs.writeFile(path.join(dir, 'show_div1.mp4'), 'one');
    await fs.writeFile(path.join(dir, 'show_div3.mp4'), 'three');
    const calls = [];

    await createFinishModel(calls).finishEncode(createFinishInfo(dir));

    assert.deepEqual(
        calls.map(call => call[0]),
        ['update-size', 'delete-input', 'notify', 'finish-event'],
    );
    assert.equal(calls[3][1].videoFileId, null);
    assert.deepEqual(calls[3][1].videoFileIds, []);
});

test('a regular output takes precedence over sidecar split files', async () => {
    const dir = await createTempDirectory();
    await fs.writeFile(path.join(dir, 'show.ts.div.txt'), '10\n20\n');
    await fs.writeFile(path.join(dir, 'show.mp4'), 'regular');
    await fs.writeFile(path.join(dir, 'show_div1.mp4'), 'stale split');
    const calls = [];

    await createFinishModel(calls, [201]).finishEncode(createFinishInfo(dir));

    assert.equal(calls[0][0], 'add-one');
    assert.equal(calls[0][1].filePath, 'show.mp4');
    assert.equal(calls[0][1].name, 'H.264');
    assert.equal(calls[3][1].videoFileId, 201);
    assert.deepEqual(calls[3][1].videoFileIds, [201]);
});

test('zero internal boundaries require one registered _div1 output', async () => {
    const dir = await createTempDirectory();
    await fs.writeFile(path.join(dir, 'show.ts.div.txt'), '');
    await fs.writeFile(path.join(dir, 'show_div1.mp4'), 'one');
    const calls = [];

    await createFinishModel(calls, [301]).finishEncode(createFinishInfo(dir));

    assert.equal(calls[0][0], 'add-many');
    assert.deepEqual(
        calls[0][1].map(option => [option.filePath, option.name]),
        [['show_div1.mp4', 'H.264_div1']],
    );
    assert.deepEqual(calls[3][1].videoFileIds, [301]);
});

test('finish hook environment keeps singular aliases and supplies source metadata and all IDs', () => {
    const info = {
        recordedId: 7,
        videoFileId: 101,
        videoFileIds: [101, 102],
        mode: 'H.264',
        inputPath: '/recorded/show.ts',
        inputVideoFileDisplayName: 'TS',
        inputVideoFileType: 'ts',
    };
    const env = EncodeFinishEnvUtil.createOutputEnv(info, '/recorded/show_div1.mp4');

    assert.equal(env.VIDEOFILEID, 101);
    assert.equal(env.VIDEOFILEIDS, '[101,102]');
    assert.equal(env.OUTPUTPATH, '/recorded/show_div1.mp4');
    assert.equal(env.INPUT, '/recorded/show.ts');
    assert.equal(env.INPUTVIDEOFILE_NAME, 'TS');
    assert.equal(env.INPUTVIDEOFILE_TYPE, 'ts');
});

test('batch VideoFile inserts preserve ID order and roll back on a later insert failure', async () => {
    let nextId = 40;
    let insertCount = 0;
    let committed = false;
    let rolledBack = false;
    let released = false;
    const queryRunner = {
        isTransactionActive: false,
        connect: async () => {},
        startTransaction: async function () {
            this.isTransactionActive = true;
        },
        manager: {
            insert: async () => {
                insertCount++;
                return { identifiers: [{ id: nextId++ }] };
            },
        },
        commitTransaction: async function () {
            committed = true;
            this.isTransactionActive = false;
        },
        rollbackTransaction: async function () {
            rolledBack = true;
            this.isTransactionActive = false;
        },
        release: async () => {
            released = true;
        },
    };
    const connection = { createQueryRunner: () => queryRunner };
    const db = new VideoFileDB({ getConnection: async () => connection }, noRetry);
    const insertedIds = await db.insertMany([{}, {}]);

    assert.deepEqual(insertedIds, [40, 41]);
    assert.equal(committed, true);
    assert.equal(rolledBack, false);
    assert.equal(released, true);

    const failingRunner = {
        ...queryRunner,
        isTransactionActive: false,
        commitTransaction: async function () {
            this.isTransactionActive = false;
        },
        rollbackTransaction: async function () {
            rolledBack = true;
            this.isTransactionActive = false;
        },
        manager: {
            insert: async () => {
                insertCount++;
                if (insertCount === 4) {
                    throw new Error('insert failed');
                }
                return { identifiers: [{ id: nextId++ }] };
            },
        },
    };
    const failingDb = new VideoFileDB({ getConnection: async () => ({ createQueryRunner: () => failingRunner }) }, noRetry);
    await assert.rejects(failingDb.insertMany([{}, {}, {}]), /insert failed/);
    assert.equal(rolledBack, true);
    assert.equal(failingRunner.isTransactionActive, false);
});

test('batch VideoFile inserts retry in a new transaction with fresh entities', async () => {
    const inputFiles = [{}, {}];
    let attempt = 0;
    let connectionCount = 0;
    const attemptStates = [];
    const insertedEntities = [];
    const connection = {
        createQueryRunner: () => {
            attempt++;
            const currentAttempt = attempt;
            let insertCount = 0;
            const state = { committed: false, rolledBack: false, released: false };
            attemptStates.push(state);

            return {
                isTransactionActive: false,
                connect: async () => {},
                startTransaction: async function () {
                    this.isTransactionActive = true;
                },
                manager: {
                    insert: async (_target, entity) => {
                        insertCount++;
                        insertedEntities.push(entity);

                        if (currentAttempt === 1 && insertCount === 1) {
                            entity.id = 900;
                            return { identifiers: [{ id: 900 }] };
                        }
                        if (currentAttempt === 1) {
                            throw new Error('SQLITE_BUSY');
                        }

                        assert.equal(entity.id, undefined, 'retry uses a fresh entity without the rolled-back ID');
                        const id = 10 + insertCount;
                        entity.id = id;
                        return { identifiers: [{ id }] };
                    },
                },
                commitTransaction: async function () {
                    state.committed = true;
                    this.isTransactionActive = false;
                },
                rollbackTransaction: async function () {
                    state.rolledBack = true;
                    this.isTransactionActive = false;
                },
                release: async () => {
                    state.released = true;
                },
            };
        },
    };
    const retryOnce = {
        run: async job => {
            try {
                return await job();
            } catch (error) {
                return await job();
            }
        },
    };
    const db = new VideoFileDB(
        {
            getConnection: async () => {
                connectionCount++;
                return connection;
            },
        },
        retryOnce,
    );

    const insertedIds = await db.insertMany(inputFiles);

    assert.deepEqual(insertedIds, [11, 12]);
    assert.equal(connectionCount, 2);
    assert.equal(attempt, 2);
    assert.deepEqual(attemptStates, [
        { committed: false, rolledBack: true, released: true },
        { committed: true, rolledBack: false, released: true },
    ]);
    assert.equal(insertedEntities.length, 4);
    assert.notEqual(insertedEntities[0], inputFiles[0]);
    assert.notEqual(insertedEntities[2], insertedEntities[0]);
    assert.equal(inputFiles[0].id, undefined);
    assert.equal(inputFiles[1].id, undefined);
});
