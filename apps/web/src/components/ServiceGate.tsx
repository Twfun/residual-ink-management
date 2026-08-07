import { App as AntApp, Alert, Button, ConfigProvider, Space, Spin, Typography } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { FolderOpenOutlined, ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { rimTheme } from '../theme';

type DesktopServiceStatus = {
  apiRunning: boolean;
  databaseRunning: boolean;
  startupError: string | null;
  logDirectory: string;
  logFile: string;
};

const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

/**
 * Desktop-only startup gate: the Tauri backend starts MariaDB/API on a
 * background thread, so the window always opens. Until the API port answers
 * we show progress here; a startup failure shows the recorded error with the
 * log directory instead of the app silently disappearing.
 */
export function ServiceGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DesktopServiceStatus | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [retrying, setRetrying] = useState(false);

  const poll = useCallback(async () => {
    try {
      const next = await invokeDesktop<DesktopServiceStatus>('service_status');
      setStatus(next);
      if (next.startupError) {
        try {
          setLogLines(await invokeDesktop<string[]>('recent_log_events', { tail: 80 }));
        } catch {
          // The log preview is best-effort; the error text itself is enough.
        }
      }
    } catch {
      // The desktop bridge is briefly unavailable during startup; keep polling.
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => window.clearInterval(timer);
  }, [poll]);

  if (!isDesktop || status?.apiRunning) return children;

  const retry = async () => {
    setRetrying(true);
    try {
      await invokeDesktop('retry_services');
      setLogLines([]);
      await poll();
    } finally {
      setRetrying(false);
    }
  };
  const openLogs = async () => {
    try {
      await invokeDesktop('open_log_directory');
    } catch {
      // Explorer may report a non-zero status even when it opened the folder.
    }
  };

  return (
    <ConfigProvider locale={zhCN} theme={rimTheme}>
      <AntApp>
        <div className="service-gate">
          {status?.startupError ? (
            <div className="service-gate-panel">
              <Alert
                type="error"
                showIcon
                message="本地服务启动失败"
                description={
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Typography.Paragraph style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                      {status.startupError}
                    </Typography.Paragraph>
                    <Typography.Text type="secondary" copyable={{ text: status.logDirectory }}>
                      日志目录：{status.logDirectory}
                    </Typography.Text>
                    <Space>
                      <Button type="primary" icon={<ReloadOutlined />} loading={retrying} onClick={retry}>
                        重试启动
                      </Button>
                      <Button icon={<FolderOpenOutlined />} onClick={openLogs}>
                        打开日志目录
                      </Button>
                    </Space>
                    {logLines.length > 0 && <pre className="service-gate-log">{logLines.join('\n')}</pre>}
                  </Space>
                }
              />
            </div>
          ) : (
            <Space direction="vertical" align="center" size={16}>
              <Spin size="large" />
              <Typography.Title level={4} style={{ margin: 0 }}>
                正在启动本地服务…
              </Typography.Title>
              <Typography.Text type="secondary">
                首次启动需要初始化数据库，可能等待 1~2 分钟，请勿关闭窗口。
              </Typography.Text>
            </Space>
          )}
        </div>
      </AntApp>
    </ConfigProvider>
  );
}
