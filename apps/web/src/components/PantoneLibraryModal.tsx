import { Input, List, Modal, Typography } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useMemo, useState } from 'react';
import { labToCss } from '../labColor';
import { PANTONE_BOOK_NAME, PANTONE_COLORS, type PantoneColor } from '../pantoneLibrary';

const PAGE_SIZE = 200;

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s-]+/g, '');
}

export function PantoneLibraryModal({
  open,
  onCancel,
  onSelect,
}: {
  open: boolean;
  onCancel: () => void;
  onSelect: (color: PantoneColor) => void;
}) {
  const [keyword, setKeyword] = useState('');
  const filtered = useMemo(() => {
    const query = normalize(keyword.trim());
    if (!query) return PANTONE_COLORS;
    return PANTONE_COLORS.filter((color) => normalize(color.name).includes(query));
  }, [keyword]);
  const visible = filtered.slice(0, PAGE_SIZE);
  return (
    <Modal
      title={`${PANTONE_BOOK_NAME} 色库（${PANTONE_COLORS.length} 色）`}
      open={open}
      onCancel={onCancel}
      footer={null}
      width={560}
      destroyOnHidden
    >
      <Input
        allowClear
        autoFocus
        prefix={<SearchOutlined />}
        placeholder="搜索色号，如 012、185、Cool Gray"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        style={{ marginBottom: 12 }}
      />
      <List
        size="small"
        style={{ maxHeight: 420, overflow: 'auto' }}
        dataSource={visible}
        locale={{ emptyText: '未找到匹配的色号。' }}
        renderItem={(color) => (
          <List.Item
            style={{ cursor: 'pointer' }}
            onClick={() => onSelect(color)}
            extra={
              <Typography.Text type="secondary" style={{ fontVariantNumeric: 'tabular-nums' }}>
                L {color.l} / a {color.a} / b {color.b}
              </Typography.Text>
            }
          >
            <List.Item.Meta
              avatar={
                <span
                  style={{
                    display: 'inline-block',
                    width: 28,
                    height: 28,
                    borderRadius: 4,
                    border: '1px solid rgba(0,0,0,0.15)',
                    background: labToCss({ l: color.l, a: color.a, b: color.b }),
                  }}
                />
              }
              title={color.name}
            />
          </List.Item>
        )}
      />
      {filtered.length > visible.length && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
          共 {filtered.length} 个匹配结果，仅显示前 {PAGE_SIZE} 个，请继续输入以缩小范围。
        </Typography.Text>
      )}
    </Modal>
  );
}
