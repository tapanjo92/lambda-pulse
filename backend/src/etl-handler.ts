import {
  FirehoseTransformationEvent,
  FirehoseTransformationResult
} from 'aws-lambda';
import { DynamoDBClient, PutItemCommand } from '@aws-sdk/client-dynamodb';
import {
  TimestreamWriteClient,
  WriteRecordsCommand,
  MeasureValueType
} from '@aws-sdk/client-timestream-write';
import { marshall } from '@aws-sdk/util-dynamodb';

const ddb = new DynamoDBClient({});
const tsWrite = new TimestreamWriteClient({});

export const handler = async (
  event: FirehoseTransformationEvent
): Promise<FirehoseTransformationResult> => {
  const now = Date.now().toString();
  const tsRecords: Array<{
    Dimensions: { Name: string; Value: string }[];
    MeasureName: string;
    MeasureValue: string;
    MeasureValueType: MeasureValueType;
    Time: string;
  }> = [];

  for (const record of event.records) {
    const payload = JSON.parse(
      Buffer.from(record.data, 'base64').toString('utf8')
    );

    // 1) Persist to DynamoDB
    await ddb.send(
      new PutItemCommand({
        TableName: process.env.METRICS_TABLE!,
        Item: marshall({
          tickerSymbol: payload.TICKER_SYMBOL,
          timestamp: now,
          price: payload.PRICE,
          change: payload.CHANGE,
          sector: payload.SECTOR,
        }),
      })
    );

    // 2) Collect for Timestream batch write
    tsRecords.push({
      Dimensions: [
        { Name: 'ticker', Value: payload.TICKER_SYMBOL },
        { Name: 'sector', Value: payload.SECTOR },
      ],
      MeasureName: 'price',
      MeasureValue: payload.PRICE.toString(),
      MeasureValueType: MeasureValueType.DOUBLE,
      Time: now,
    });
  }

  // 3) Write to Timestream in one batch
  if (tsRecords.length) {
    await tsWrite.send(
      new WriteRecordsCommand({
        DatabaseName: process.env.TS_DATABASE!,
        TableName: process.env.TS_TABLE!,
        Records: tsRecords,
      })
    );
  }

  // 4) Return all records back to Firehose so they still land in S3
  return {
    records: event.records.map((r) => ({
      recordId: r.recordId,
      result: 'Ok',
      data: r.data,
    })),
  };
};

