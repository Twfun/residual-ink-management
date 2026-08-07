import { Card, Statistic } from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

export function MetricCard({ title, value, suffix }: { title: string; value: string | number; suffix?: ReactNode }) {
  return (
    <Card className="metric-card">
      <Statistic title={title} value={value} suffix={suffix} />
    </Card>
  );
}

export function EmptyState({ text = '暂无数据' }: { text?: string }) {
  return (
    <div className="empty-state">
      <InboxOutlined />
      <span>{text}</span>
    </div>
  );
}
