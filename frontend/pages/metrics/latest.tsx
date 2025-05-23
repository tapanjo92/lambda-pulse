import useSWR from 'swr';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer
} from 'recharts';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function LatestMetrics() {
  const { data, error } = useSWR(
    `${process.env.NEXT_PUBLIC_API_URL}metrics/latest`,
    fetcher
  );
  if (error) return <div>Failed to load metrics</div>;
  if (!data)  return <div>Loading…</div>;

  const chartData = data.map((item: any) => ({
    name: item.ticker,
    price: Number(item.price),
  }));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Latest Metrics</h1>
      <div style={{ width: '100%', height: 300 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="price" name="Price" />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="min-w-full table-auto border">
        <thead>
          <tr>
            <th className="px-4 py-2">Time</th>
            <th className="px-4 py-2">Ticker</th>
            <th className="px-4 py-2">Price</th>
            <th className="px-4 py-2">Sector</th>
          </tr>
        </thead>
        <tbody>
          {data.map((item: any) => (
            <tr key={`${item.ticker}_${item.time}`} className="border-t">
              <td className="px-4 py-2">{new Date(item.time).toLocaleString()}</td>
              <td className="px-4 py-2">{item.ticker}</td>
              <td className="px-4 py-2">{item.price}</td>
              <td className="px-4 py-2">{item.sector}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

