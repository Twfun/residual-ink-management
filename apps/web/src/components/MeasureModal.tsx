import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Modal, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined } from '@ant-design/icons';
import { labToCss, parseXriteMeasurement, type XriteMeasurement } from '../labColor';

const MEASURE_TIMEOUT_MS = 60_000;

type Phase = 'waiting' | 'success' | 'error';

export function MeasureModal({
  open,
  onCancel,
  onSuccess,
}: {
  open: boolean;
  onCancel: () => void;
  onSuccess: (measurement: XriteMeasurement) => void;
}) {
  const [phase, setPhase] = useState<Phase>('waiting');
  const [error, setError] = useState('');
  const [result, setResult] = useState<XriteMeasurement | null>(null);
  const [autoClose, setAutoClose] = useState(true);
  const seqRef = useRef(0);
  const successRef = useRef(onSuccess);
  successRef.current = onSuccess;

  // Real instrument press: the bridge waits for the operator to press the
  // eXact onto the target until the device shows the finished reading.
  const start = useCallback(async () => {
    const seq = ++seqRef.current;
    setPhase('waiting');
    setError('');
    setResult(null);
    try {
      if (!('__TAURI_INTERNALS__' in window)) throw new Error('仪器测量仅在桌面安装版可用。');
      const { invoke } = await import('@tauri-apps/api/core');
      const response = await Promise.race([
        invoke<any>('xrite_command', { command: 'wait 30000' }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('measure-timeout')), MEASURE_TIMEOUT_MS);
        }),
      ]);
      if (seqRef.current !== seq) return;
      if (!response?.ok) throw new Error(response?.error?.message || '仪器未返回有效测量值。');
      const measurement = parseXriteMeasurement(response);
      if (!measurement) throw new Error('测量已完成，但返回结果中未找到完整的 Lab 值。');
      setResult(measurement);
      setPhase('success');
    } catch (cause) {
      if (seqRef.current !== seq) return;
      const timedOut = cause instanceof Error && cause.message === 'measure-timeout';
      setError(
        timedOut
          ? '60 秒内未获取到仪器测量结果，请重新测量。请重新将 eXact 按向目标基座后点击「重新开始监听」。'
          : cause instanceof Error
            ? cause.message
            : '测量失败。',
      );
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (open) void start();
    return () => {
      seqRef.current += 1;
    };
  }, [open, start]);

  // auto finish + close shortly after a successful reading (default on)
  useEffect(() => {
    if (phase !== 'success' || !result || !autoClose) return;
    const timer = setTimeout(() => successRef.current(result), 600);
    return () => clearTimeout(timer);
  }, [phase, result, autoClose]);

  const waiting = phase === 'waiting';
  return (
    <Modal
      open={open}
      title="测量当前油墨调合色"
      onCancel={onCancel}
      footer={null}
      width={440}
      destroyOnHidden
    >
      {phase === 'error' && (
        <div className="measure-error">
          <CloseCircleOutlined className="measure-error-icon" />
          <div>
            <div className="measure-error-title">本次测量未完成</div>
            <div className="measure-error-detail">{error}</div>
          </div>
        </div>
      )}
      <div className="measure-body">
        <div className="measure-swatch-col">
          <div
            className={`color-swatch${result ? '' : ' color-swatch-idle'}`}
            style={result ? { background: labToCss(result) } : undefined}
          >
            {waiting && <LoadingOutlined />}
            {phase === 'success' && <CheckCircleOutlined style={{ color: '#fff' }} />}
          </div>
          <span className="measure-swatch-caption">
            {result ? `L* ${result.l}　a* ${result.a}　b* ${result.b}` : '等待测量'}
          </span>
        </div>
        <div className="measure-status-table">
          <div className="measure-status-row">
            <span>连接状态</span>
            <span>{phase === 'error' ? '未确认' : '已连接'}</span>
          </div>
          <div className="measure-status-row">
            <span>测量条件</span>
            <span>{result?.measureCondition ?? 'M0'}</span>
          </div>
          {result?.densityT !== null && result?.densityT !== undefined && (
            <div className="measure-status-row">
              <span>密度 T</span>
              <span>{result.densityT}</span>
            </div>
          )}
        </div>
      </div>
      {waiting && (
        <Typography.Paragraph type="secondary" className="measure-guide-text">
          将 eXact 用力按向目标基座，保持到仪器显示「完成！」与 Lab 数据。
        </Typography.Paragraph>
      )}
      <div className="measure-options">
        <Checkbox checked={autoClose} onChange={(event) => setAutoClose(event.target.checked)}>
          自动完成并关闭窗口
        </Checkbox>
      </div>
      <div className="measure-actions">
        <Button onClick={onCancel}>取消</Button>
        {phase === 'success' && !autoClose ? (
          <Button type="primary" onClick={() => result && successRef.current(result)}>
            完成并使用读数
          </Button>
        ) : (
          <Button type="primary" loading={waiting} onClick={() => void start()}>
            {phase === 'error' ? '重新开始监听' : '开始测量'}
          </Button>
        )}
      </div>
    </Modal>
  );
}
