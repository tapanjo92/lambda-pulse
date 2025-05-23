import { APIGatewayProxyHandler } from 'aws-lambda';
import {
  TimestreamQueryClient,
  QueryCommand,
  ColumnInfo
} from '@aws-sdk/client-timestream-query';

const tsQuery = new TimestreamQueryClient({});

export const handler: APIGatewayProxyHandler = async () => {
  // 1) Query all columns for the 'price' measure
  const query = `
    SELECT *
    FROM "${process.env.TS_DATABASE}"."${process.env.TS_TABLE}"
    WHERE measure_name = 'price'
    ORDER BY time DESC
    LIMIT 10
  `;

  // 2) Execute the query
  const resp = await tsQuery.send(new QueryCommand({ QueryString: query }));

  // 3) Extract column metadata and rows
  const cols: ColumnInfo[] = resp.ColumnInfo || [];
  const rows = resp.Rows || [];

  // 4) Map each row into a JS object
  const results = rows.map(r => {
    const obj: any = {};
    r.Data?.forEach((datum, idx) => {
      const colName = cols[idx].Name!;          // e.g. "time", "ticker", "measure_value::double"
      const val     = datum.ScalarValue || ''; // the raw string value

      // Detect the measure-value column dynamically
      if (colName.startsWith('measure_value')) {
        obj.price = Number(val);                // cast it to a Number
      } else {
        obj[colName] = val;                     // copy other columns verbatim
      }
    });
    return obj;
  });

  // 5) Return the JSON payload
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(results),
  };
};

