import { Operation } from 'express-openapi';
import IEncodeApiModel from '../../../api/encode/IEncodeApiModel';
import container from '../../../ModelContainer';
import * as api from '../../api';

export const del: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        await encodeApiModel.cancel(parseInt(req.params.encodeId, 10));
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

del.apiDoc = {
    summary: 'エンコードをキャンセル',
    tags: ['encode'],
    description: 'エンコードをキャンセルする',
    parameters: [
        {
            $ref: '#/components/parameters/PathEncodeId',
        },
    ],
    responses: {
        200: {
            description: 'エンコードをキャンセルしました',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};

export const put: Operation = async (req, res) => {
    const encodeApiModel = container.get<IEncodeApiModel>('IEncodeApiModel');

    try {
        const direction = req.body.direction as string;
        if (direction !== 'up' && direction !== 'down') {
            api.responseServerError(res, 'InvalidDirection');
            return;
        }
        encodeApiModel.move(parseInt(req.params.encodeId, 10), direction as 'up' | 'down');
        api.responseJSON(res, 200, { code: 200 });
    } catch (err: any) {
        api.responseServerError(res, err.message);
    }
};

put.apiDoc = {
    summary: 'エンコード順番変更',
    tags: ['encode'],
    description: 'waitキュー内のエンコード順番を変更する',
    parameters: [
        {
            $ref: '#/components/parameters/PathEncodeId',
        },
    ],
    requestBody: {
        content: {
            'application/json': {
                schema: {
                    type: 'object',
                    properties: {
                        direction: {
                            type: 'string',
                            enum: ['up', 'down'],
                        },
                    },
                    required: ['direction'],
                },
            },
        },
        required: true,
    },
    responses: {
        200: {
            description: '順番を変更しました',
        },
        default: {
            description: '予期しないエラー',
            content: {
                'application/json': {
                    schema: {
                        $ref: '#/components/schemas/Error',
                    },
                },
            },
        },
    },
};
