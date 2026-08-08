import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from './api';

const MATERIAL_TYPE_LABELS: Record<string, string> = { ink: '油墨', solvent: '溶剂', additive: '添加剂' };
const FORMULA_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'gold' },
  published: { label: '已发布', color: 'green' },
  disabled: { label: '已停用', color: 'default' },
};

function num(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function MaterialsPage({ token, rights, embedded }: { token: string; rights: string[]; embedded?: boolean }) {
  const { message } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [type, setType] = useState<string>();
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const canEdit = rights.includes('material.edit');
  const materialType = Form.useWatch('materialType', form);

  const load = async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (keyword.trim()) query.set('keyword', keyword.trim());
      if (type) query.set('type', type);
      setRows(await api<any[]>(`/materials${query.size ? `?${query}` : ''}`, {}, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const openEdit = (row?: any) => {
    setEditing(row ?? {});
    form.setFieldsValue(
      row ?? { materialType: 'ink', viscosityUnit: 's', status: '启用', isDefaultSolvent: false },
    );
  };
  const save = async () => {
    const values = await form.validateFields();
    const payload = { ...values, isDefaultSolvent: values.materialType === 'solvent' ? !!values.isDefaultSolvent : false };
    try {
      await api(editing?.id ? `/materials/${editing.id}` : '/materials', {
        method: editing?.id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      }, token);
      message.success('已保存。');
      setEditing(null);
      void load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    }
  };

  const toolbar = (
    <Space wrap>
      <Input.Search allowClear placeholder="编码、名称、厂家或系列" style={{ width: 240 }} onSearch={(value) => { setKeyword(value); setTimeout(() => void load(), 0); }} onChange={(e) => setKeyword(e.target.value)} />
      <Select
        allowClear
        placeholder="类型"
        style={{ width: 120 }}
        value={type}
        onChange={(value) => { setType(value); setTimeout(() => void load(), 0); }}
        options={Object.entries(MATERIAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
      />
      <Button onClick={() => void load()}>查询</Button>
      {canEdit && <Button type="primary" onClick={() => openEdit()}>新增物料</Button>}
    </Space>
  );

  const table = (
    <Table
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={rows}
      pagination={{ defaultPageSize: 20, showSizeChanger: true }}
      columns={[
        { title: '编码', dataIndex: 'code', width: 110 },
        { title: '名称', dataIndex: 'name', width: 140 },
        { title: '类型', dataIndex: 'materialType', width: 80, render: (value: string) => <Tag>{MATERIAL_TYPE_LABELS[value] ?? value}</Tag> },
        { title: '色系', dataIndex: 'colorFamily', width: 90 },
        { title: '厂家', dataIndex: 'manufacturer', width: 120 },
        { title: '品牌', dataIndex: 'brand', width: 100 },
        { title: '系列', dataIndex: 'series', width: 100 },
        { title: '默认粘度', dataIndex: 'defaultViscosity', width: 100, render: (value: any, row: any) => (value === null || value === undefined ? '—' : `${value} ${row.viscosityUnit ?? 's'}`) },
        { title: '测量方式', dataIndex: 'viscosityMethod', width: 110 },
        { title: '温度', dataIndex: 'viscosityTemperature', width: 80, render: (value: any) => (value === null || value === undefined ? '—' : `${value}℃`) },
        { title: '默认溶剂', dataIndex: 'isDefaultSolvent', width: 90, render: (value: boolean) => (value ? <Tag color="green">默认溶剂</Tag> : '') },
        { title: '状态', dataIndex: 'status', width: 80, render: (value: string) => <Tag color={value === '启用' ? 'green' : 'default'}>{value}</Tag> },
        { title: '备注', dataIndex: 'remark', ellipsis: true },
        {
          title: '操作',
          key: 'action',
          width: 90,
          render: (_: unknown, row: any) => (
            <Button size="small" disabled={!canEdit} onClick={() => openEdit(row)}>编辑</Button>
          ),
        },
      ]}
    />
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {embedded ? (
        <>
          {toolbar}
          {table}
        </>
      ) : (
        <Card title="配方物料" extra={toolbar}>
          {table}
        </Card>
      )}
      <Modal
        open={!!editing}
        title={editing?.id ? `编辑物料 ${editing.code}` : '新增物料'}
        onCancel={() => setEditing(null)}
        onOk={() => void save()}
        width={720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" className="form-grid">
          <Form.Item name="code" label="物料编码" rules={[{ required: true, message: '请输入物料编码' }]}>
            <Input disabled={!!editing?.id} />
          </Form.Item>
          <Form.Item name="name" label="物料名称" rules={[{ required: true, message: '请输入物料名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="materialType" label="物料类型" rules={[{ required: true }]}>
            <Select options={Object.entries(MATERIAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="colorFamily" label="色系">
            <Input placeholder="油墨使用，如 红/黄/蓝/黑" />
          </Form.Item>
          <Form.Item name="manufacturer" label="厂家">
            <Input />
          </Form.Item>
          <Form.Item name="brand" label="品牌">
            <Input />
          </Form.Item>
          <Form.Item name="series" label="系列/体系">
            <Input />
          </Form.Item>
          <Form.Item name="defaultViscosity" label="默认粘度（s）">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="viscosityMethod" label="粘度测量方式">
            <Input placeholder="如 涂-4 杯" />
          </Form.Item>
          <Form.Item name="viscosityTemperature" label="测量温度（℃）">
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="density" label="密度">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="unitCost" label="成本单价（预留）">
            <InputNumber style={{ width: '100%' }} min={0} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
            <Select options={['启用', '停用'].map((value) => ({ value, label: value }))} />
          </Form.Item>
          {materialType === 'solvent' && (
            <Form.Item name="isDefaultSolvent" label="设为默认溶剂（正丙酯）" valuePropName="checked">
              <Switch />
            </Form.Item>
          )}
          <Form.Item name="remark" label="备注" style={{ gridColumn: '1 / -1' }}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
function ProductModal({ token, value, onClose, onSaved }: { token: string; value: any; onClose: () => void; onSaved: () => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  useEffect(() => {
    if (!value) return;
    if (!value.id) {
      form.setFieldsValue({ status: '启用' });
      return;
    }
    form.setFieldsValue({
      ...value,
      archiveDate: value.archiveDate ? dayjs(String(value.archiveDate).slice(0, 10)) : null,
    });
  }, [value, form]);
  const save = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      archiveDate: values.archiveDate ? values.archiveDate.format('YYYY-MM-DD') : null,
    };
    try {
      await api(value.id ? `/products/${value.id}` : '/products', {
        method: value.id ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      }, token);
      message.success('已保存。');
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    }
  };
  return (
    <Modal open={!!value} title={value?.id ? `编辑产品 ${value.code}` : '新增产品'} onCancel={onClose} onOk={() => void save()} width={640} destroyOnHidden>
      <Form form={form} layout="vertical" className="form-grid">
        <Form.Item name="code" label="产品编码" rules={[{ required: true, message: '请输入产品编码' }]}>
          <Input disabled={!!value?.id} placeholder="如 P-2026-001" />
        </Form.Item>
        <Form.Item name="formulaNo" label="配方编号">
          <Input placeholder="如 F-2026-001" />
        </Form.Item>
        <Form.Item name="name" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="customerName" label="客户名称">
          <Input />
        </Form.Item>
        <Form.Item name="archiveDate" label="归档日期">
          <DatePicker style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="specification" label="规格">
          <Input />
        </Form.Item>
        <Form.Item name="substrate" label="承印材料">
          <Input />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select options={['启用', '停用'].map((v) => ({ value: v, label: v }))} />
        </Form.Item>
        <Form.Item name="processNote" label="工艺备注" style={{ gridColumn: '1 / -1' }}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ColorModal({ token, productId, value, onClose, onSaved }: { token: string; productId: string; value: any; onClose: () => void; onSaved: () => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  useEffect(() => {
    if (value) form.setFieldsValue(value.id ? value : { viscosityUnit: 's', status: '启用' });
  }, [value, form]);
  const save = async () => {
    const values = await form.validateFields();
    try {
      await api(value.id ? `/product-colors/${value.id}` : `/products/${productId}/colors`, {
        method: value.id ? 'PATCH' : 'POST',
        body: JSON.stringify(values),
      }, token);
      message.success('已保存。');
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    }
  };
  return (
    <Modal open={!!value} title={value?.id ? `编辑专色 ${value.name}` : '新增专色'} onCancel={onClose} onOk={() => void save()} width={640} destroyOnHidden>
      <Form form={form} layout="vertical" className="form-grid">
        <Form.Item name="name" label="专色名称" rules={[{ required: true, message: '请输入专色名称' }]}>
          <Input placeholder="如 专红" />
        </Form.Item>
        <Form.Item name="colorCode" label="专色编号">
          <Input />
        </Form.Item>
        <Form.Item name="printOrder" label="印刷色序">
          <InputNumber style={{ width: '100%' }} min={1} />
        </Form.Item>
        <Form.Item name="targetViscosity" label="目标粘度（s）">
          <InputNumber style={{ width: '100%' }} min={0} />
        </Form.Item>
        <Form.Item name="viscosityMethod" label="粘度测量方式">
          <Input placeholder="如 涂-4 杯" />
        </Form.Item>
        <Form.Item name="viscosityTemperature" label="测量温度（℃）">
          <InputNumber style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="status" label="状态" rules={[{ required: true }]}>
          <Select options={['启用', '停用'].map((v) => ({ value: v, label: v }))} />
        </Form.Item>
        <Form.Item name="remark" label="工艺备注" style={{ gridColumn: '1 / -1' }}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function FormulasPage({ token, rights }: { token: string; rights: string[] }) {
  const { message } = AntApp.useApp();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail] = useState<any | null>(null);
  const [editingProduct, setEditingProduct] = useState<any | null>(null);
  const [editingColor, setEditingColor] = useState<any | null>(null);
  const [formulaColor, setFormulaColor] = useState<any | null>(null);
  const [materialOpen, setMaterialOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const canEdit = rights.includes('formula.edit');

  const load = async (nextKeyword = keyword) => {
    setLoading(true);
    try {
      const query = nextKeyword.trim() ? `?keyword=${encodeURIComponent(nextKeyword.trim())}` : '';
      setProducts(await api<any[]>(`/products${query}`, {}, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    } finally {
      setLoading(false);
    }
  };
  const openDetail = async (row: any) => {
    try {
      setDetail(await api<any>(`/products/${row.id}`, {}, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    }
  };
  useEffect(() => {
    void load('');
  }, []);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="配方档案"
        extra={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="产品编码、名称、客户或规格"
              style={{ width: 280 }}
              onSearch={(value) => void load(value)}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Button onClick={() => setMaterialOpen(true)}>配方物料</Button>
            {canEdit && <Button type="primary" onClick={() => setQuickOpen(true)}>新增配方</Button>}
            {canEdit && <Button onClick={() => setEditingProduct({})}>新增产品</Button>}
          </Space>
        }
      >
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={products}
          pagination={{ defaultPageSize: 20, showSizeChanger: true }}
          columns={[
            { title: '产品编码', dataIndex: 'code', width: 120 },
            { title: '配方编号', dataIndex: 'formulaNo', width: 120, render: (value: any) => value ?? '—' },
            { title: '产品名称', dataIndex: 'name', width: 170 },
            { title: '客户', dataIndex: 'customerName', width: 130 },
            { title: '归档日期', dataIndex: 'archiveDate', width: 100, render: (value: any) => (value ? String(value).slice(0, 10) : '—') },
            { title: '规格', dataIndex: 'specification', width: 130 },
            { title: '承印材料', dataIndex: 'substrate', width: 110 },
            { title: '专色数', key: 'colors', width: 70, render: (_: unknown, row: any) => row._count?.colors ?? 0 },
            { title: '状态', dataIndex: 'status', width: 70, render: (value: string) => <Tag color={value === '启用' ? 'green' : 'default'}>{value}</Tag> },
            {
              title: '操作',
              key: 'action',
              width: 170,
              render: (_: unknown, row: any) => (
                <Space size={4}>
                  <Button size="small" type="primary" onClick={() => void openDetail(row)}>查看配方</Button>
                  <Button size="small" disabled={!canEdit} onClick={() => setEditingProduct(row)}>编辑</Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      {detail && (
        <Card
          title={`${detail.name}（${detail.code}）的专色`}
          extra={canEdit && <Button onClick={() => setEditingColor({})}>新增专色</Button>}
        >
          <Table
            rowKey="id"
            size="small"
            dataSource={detail.colors ?? []}
            pagination={false}
            columns={[
              { title: '色序', dataIndex: 'printOrder', width: 70 },
              { title: '专色名称', dataIndex: 'name', width: 120 },
              { title: '专色编号', dataIndex: 'colorCode', width: 110 },
              { title: '目标粘度', dataIndex: 'targetViscosity', width: 110, render: (value: any, row: any) => (value === null || value === undefined ? '—' : `${value} ${row.viscosityUnit ?? 's'}${row.viscosityMethod ? ` / ${row.viscosityMethod}` : ''}`) },
              {
                title: '当前有效配方',
                key: 'formula',
                render: (_: unknown, row: any) => {
                  const formula = row.formulas?.[0];
                  if (!formula) return <Typography.Text type="warning">暂无已发布配方</Typography.Text>;
                  const summary = (formula.items ?? []).map((item: any) => `${item.material?.name ?? ''} ${item.ratioPart}`).join(' + ');
                  return (
                    <Space size={8} wrap>
                      <Tag color="green">V{formula.versionNo}</Tag>
                      <span>{summary}</span>
                    </Space>
                  );
                },
              },
              { title: '状态', dataIndex: 'status', width: 80, render: (value: string) => <Tag color={value === '启用' ? 'green' : 'default'}>{value}</Tag> },
              {
                title: '操作',
                key: 'action',
                width: 170,
                render: (_: unknown, row: any) => (
                  <Space size={4}>
                    <Button size="small" type="primary" onClick={() => setFormulaColor(row)}>配方管理</Button>
                    <Button size="small" disabled={!canEdit} onClick={() => setEditingColor(row)}>编辑</Button>
                  </Space>
                ),
              },
            ]}
          />
        </Card>
      )}
      {editingProduct && (
        <ProductModal
          token={token}
          value={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null);
            void load();
          }}
        />
      )}
      {editingColor && detail && (
        <ColorModal
          token={token}
          productId={detail.id}
          value={editingColor}
          onClose={() => setEditingColor(null)}
          onSaved={() => {
            setEditingColor(null);
            void openDetail(detail);
          }}
        />
      )}
      {formulaColor && (
        <FormulaVersionModal
          token={token}
          rights={rights}
          color={formulaColor}
          onClose={() => {
            setFormulaColor(null);
            if (detail) void openDetail(detail);
          }}
        />
      )}
      <Drawer
        open={materialOpen}
        onClose={() => setMaterialOpen(false)}
        title="配方物料"
        width={1180}
      >
        <MaterialsPage token={token} rights={rights} embedded />
      </Drawer>
      {quickOpen && (
        <QuickFormulaModal
          token={token}
          onClose={() => setQuickOpen(false)}
          onSaved={() => {
            setQuickOpen(false);
            void load();
          }}
        />
      )}
    </Space>
  );
}
function QuickFormulaModal({ token, onClose, onSaved }: { token: string; onClose: () => void; onSaved: () => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    let values: any;
    try {
      values = await form.validateFields();
    } catch (error) {
      if ((error as any)?.errorFields?.length) message.warning('请完善必填项。');
      else if (error instanceof Error) message.error(error.message);
      return;
    }
    const rows = (values.rows ?? []).filter((row: any) => row && (row.colorName || row.inkName));
    if (rows.length === 0) {
      message.warning('请至少填写一条配方明细。');
      return;
    }
    setSaving(true);
    try {
      await api('/products/formula', {
        method: 'POST',
        body: JSON.stringify({
          formulaNo: values.formulaNo || null,
          customerName: values.customerName || null,
          productName: values.productName,
          productCode: values.productCode,
          archiveDate: values.archiveDate ? values.archiveDate.format('YYYY-MM-DD') : null,
          remark: values.remark || null,
          rows: rows.map((row: any, index: number) => ({
            sortNo: row.sortNo ?? index + 1,
            colorName: row.colorName,
            viscosity: row.viscosity ?? null,
            labL: row.labL ?? null,
            labA: row.labA ?? null,
            labB: row.labB ?? null,
            inkName: row.inkName,
            inkBrand: row.inkBrand || null,
            weightKg: row.weightKg ?? null,
            note: row.note || null,
          })),
        }),
      }, token);
      message.success('配方档案已创建。');
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败。');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title="新增配方"
      onCancel={onClose}
      onOk={() => void save()}
      confirmLoading={saving}
      width={1120}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <section className="form-section">
          <Typography.Title level={5} style={{ marginTop: 0 }}>基础信息</Typography.Title>
          <div className="form-grid">
            <Form.Item name="formulaNo" label="配方编号">
              <Input placeholder="留空自动生成" />
            </Form.Item>
            <Form.Item name="customerName" label="客户">
              <Input />
            </Form.Item>
            <Form.Item name="productName" label="产品名称" rules={[{ required: true, message: '请输入产品名称' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="productCode" label="产品编码" rules={[{ required: true, message: '请输入产品编码' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="archiveDate" label="归档日期">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </section>
        <section className="form-section">
          <Typography.Title level={5} style={{ marginTop: 0 }}>配方明细</Typography.Title>
          <Form.List name="rows">
            {(fields, { add, remove }) => (
              <Table
                rowKey="key"
                size="small"
                pagination={false}
                dataSource={fields}
                footer={() => (
                  <Button size="small" type="dashed" onClick={() => add({})}>+ 新增原料</Button>
                )}
                columns={[
                  {
                    title: '色序',
                    key: 'sortNo',
                    width: 70,
                    render: (_: unknown, field: any) => (
                      <Form.Item name={[field.name, 'sortNo']} noStyle>
                        <InputNumber min={1} style={{ width: '100%' }} />
                      </Form.Item>
                    ),
                  },
                  {
                    title: '颜色名称',
                    key: 'colorName',
                    width: 110,
                    render: (_: unknown, field: any) => (
                      <Form.Item name={[field.name, 'colorName']} rules={[{ required: true, message: '必填' }]} noStyle>
                        <Input />
                      </Form.Item>
                    ),
                  },
                  {
                    title: '粘度',
                    key: 'viscosity',
                    width: 80,
                    render: (_: unknown, field: any) => (
                      <Form.Item name={[field.name, 'viscosity']} noStyle>
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                    ),
                  },
                  {
                    title: 'LAB值',
                    key: 'lab',
                    width: 170,
                    render: (_: unknown, field: any) => (
                      <Space size={4}>
                        <Form.Item name={[field.name, 'labL']} noStyle>
                          <InputNumber placeholder="L" style={{ width: 52 }} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'labA']} noStyle>
                          <InputNumber placeholder="a" style={{ width: 52 }} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'labB']} noStyle>
                          <InputNumber placeholder="b" style={{ width: 52 }} />
                        </Form.Item>
                      </Space>
                    ),
                  },
                  {
                    title: '油墨颜色',
                    key: 'inkName',
                    width: 120,
                    render: (_: unknown, field: any) => (
                      <Form.Item name={[field.name, 'inkName']} rules={[{ required: true, message: '必填' }]} noStyle>
                        <Input />
                      </Form.Item>
                    ),
                  },
                  {
                    title: '油墨品牌',
                    key: 'inkBrand',
                    width: 110,
                    render: (_: unknown, field: any) => (
                      <Form.Item name={[field.name, 'inkBrand']} noStyle>
                        <Input />
                      </Form.Item>
                    ),
                  },
                  {
                    title: '用量kg',
                    key: 'weightKg',
                    width: 90,
                    render: (_: unknown, field: any) => (
                      <Form.Item name={[field.name, 'weightKg']} noStyle>
                        <InputNumber min={0} style={{ width: '100%' }} />
                      </Form.Item>
                    ),
                  },
                  {
                    title: '备注',
                    key: 'note',
                    render: (_: unknown, field: any) => (
                      <Form.Item name={[field.name, 'note']} noStyle>
                        <Input />
                      </Form.Item>
                    ),
                  },
                  {
                    title: '操作',
                    key: 'action',
                    width: 60,
                    render: (_: unknown, field: any) => (
                      <Button size="small" danger type="link" onClick={() => remove(field.name)}>移除</Button>
                    ),
                  },
                ]}
              />
            )}
          </Form.List>
        </section>
        <section className="form-section">
          <Typography.Title level={5} style={{ marginTop: 0 }}>备注</Typography.Title>
          <Form.Item name="remark" noStyle>
            <Input.TextArea rows={2} />
          </Form.Item>
        </section>
      </Form>
    </Modal>
  );
}
function CalculateModal({ token, formula, onClose }: { token: string; formula: any; onClose: () => void }) {
  const { message } = AntApp.useApp();
  const [targetWeight, setTargetWeight] = useState<number | null>(null);
  const [result, setResult] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (!targetWeight || targetWeight <= 0) {
      message.warning('请输入有效的目标重量。');
      return;
    }
    setLoading(true);
    try {
      setResult(await api<any>(`/formulas/${formula.id}/calculate`, { method: 'POST', body: JSON.stringify({ targetWeight }) }, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '计算失败。');
    } finally {
      setLoading(false);
    }
  };
  return (
    <Modal open title={`按重量计算 · V${formula.versionNo}`} footer={null} onCancel={onClose} width={720}>
      <Space style={{ marginBottom: 12 }}>
        <span>目标总重量（kg）：</span>
        <InputNumber min={0} value={targetWeight} onChange={(value) => setTargetWeight(value)} style={{ width: 160 }} />
        <Button type="primary" loading={loading} onClick={() => void run()}>计算</Button>
        {result && <Tag>总份数 {result.totalParts}</Tag>}
      </Space>
      {result && (
        <Table
          rowKey="materialCode"
          size="small"
          pagination={false}
          dataSource={result.items}
          columns={[
            { title: '物料编码', dataIndex: 'materialCode', width: 110 },
            { title: '名称', dataIndex: 'name', width: 130 },
            { title: '类型', dataIndex: 'materialType', width: 80, render: (value: string) => MATERIAL_TYPE_LABELS[value] ?? value },
            { title: '厂家', dataIndex: 'manufacturer', width: 110, render: (value: any) => value ?? '—' },
            { title: '配比（份）', dataIndex: 'ratioPart', width: 100 },
            { title: '百分比', dataIndex: 'ratioPercent', width: 100, render: (value: number) => `${value}%` },
            { title: '投料重量（kg）', dataIndex: 'weightKg', width: 130, render: (value: number) => <b>{value.toFixed(3)}</b> },
          ]}
        />
      )}
    </Modal>
  );
}

function FormulaDetailModal({ formula, onClose }: { formula: any; onClose: () => void }) {
  const status = FORMULA_STATUS_LABELS[formula.status] ?? { label: formula.status, color: 'default' };
  return (
    <Modal open title={`配方详情 · V${formula.versionNo}`} footer={null} onCancel={onClose} width={860}>
      <Descriptions size="small" column={3} style={{ marginBottom: 12 }}>
        <Descriptions.Item label="状态"><Tag color={status.color}>{status.label}</Tag></Descriptions.Item>
        <Descriptions.Item label="基准">{formula.basisType}</Descriptions.Item>
        <Descriptions.Item label="目标粘度">
          {formula.targetViscosity === null || formula.targetViscosity === undefined ? '—' : `${formula.targetViscosity} ${formula.viscosityUnit ?? 's'}`}
          {formula.viscosityMethod ? ` / ${formula.viscosityMethod}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="创建">{formula.createdBy ?? '—'} {formula.createdAt ? String(formula.createdAt).slice(0, 10) : ''}</Descriptions.Item>
        <Descriptions.Item label="发布">{formula.publishedBy ?? '—'} {formula.publishedAt ? String(formula.publishedAt).slice(0, 10) : ''}</Descriptions.Item>
        <Descriptions.Item label="变更原因">{formula.changeReason ?? '—'}</Descriptions.Item>
      </Descriptions>
      <Table
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={formula.items ?? []}
        columns={[
          { title: '物料编码', dataIndex: ['material', 'code'], width: 110 },
          { title: '名称', dataIndex: ['material', 'name'], width: 130 },
          { title: '类型', key: 'type', width: 80, render: (_: unknown, row: any) => MATERIAL_TYPE_LABELS[row.materialTypeSnapshot ?? row.material?.materialType] ?? '—' },
          { title: '厂家', key: 'manufacturer', width: 120, render: (_: unknown, row: any) => row.manufacturerSnapshot ?? row.material?.manufacturer ?? '—' },
          { title: '配比（份）', dataIndex: 'ratioPart', width: 100 },
          { title: '百分比', dataIndex: 'ratioPercent', width: 100, render: (value: any) => (value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}%`) },
          { title: '粘度快照', dataIndex: 'viscositySnapshot', width: 150, render: (value: any) => value ?? '—' },
          { title: '备注', dataIndex: 'componentNote', ellipsis: true },
        ]}
      />
    </Modal>
  );
}

function FormulaVersionModal({ token, rights, color, onClose }: { token: string; rights: string[]; color: any; onClose: () => void }) {
  const { message, modal } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [calculating, setCalculating] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [adjusting, setAdjusting] = useState<any | null>(null);
  const canEdit = rights.includes('formula.edit');
  const canPublish = rights.includes('formula.publish');

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api<any[]>(`/product-colors/${color.id}/formulas`, {}, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const createDraft = async () => {
    try {
      const draft = await api<any>(`/product-colors/${color.id}/formulas`, { method: 'POST', body: JSON.stringify({}) }, token);
      message.success(`已创建草稿 V${draft.versionNo}，默认溶剂已自动加入。`);
      await load();
      setEditing(draft);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败。');
    }
  };
  const action = async (path: string, success: string) => {
    try {
      await api(path, { method: 'POST' }, token);
      message.success(success);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '操作失败。');
    }
  };

  return (
    <Modal
      open
      title={`配方管理 · ${color.name}`}
      footer={null}
      onCancel={onClose}
      width={1080}
      destroyOnHidden
    >
      {canEdit && (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={() => void createDraft()}>新建配方草稿</Button>
        </Space>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '版本', dataIndex: 'versionNo', width: 70, render: (value: number) => `V${value}` },
          { title: '状态', dataIndex: 'status', width: 90, render: (value: string) => { const s = FORMULA_STATUS_LABELS[value] ?? { label: value, color: 'default' }; return <Tag color={s.color}>{s.label}</Tag>; } },
          { title: '组分数', key: 'items', width: 80, render: (_: unknown, row: any) => row.items?.length ?? 0 },
          { title: '目标粘度', dataIndex: 'targetViscosity', width: 100, render: (value: any, row: any) => (value === null || value === undefined ? '—' : `${value} ${row.viscosityUnit ?? 's'}`) },
          { title: '创建', key: 'created', width: 150, render: (_: unknown, row: any) => `${row.createdBy ?? '—'} ${row.createdAt ? String(row.createdAt).slice(0, 10) : ''}` },
          { title: '发布', key: 'published', width: 150, render: (_: unknown, row: any) => (row.publishedAt ? `${row.publishedBy ?? ''} ${String(row.publishedAt).slice(0, 10)}` : '—') },
          { title: '调色', key: 'adjustments', width: 70, render: (_: unknown, row: any) => row._count?.adjustments ?? 0 },
          {
            title: '操作',
            key: 'action',
            render: (_: unknown, row: any) => (
              <Space size={4} wrap>
                <Button size="small" onClick={() => setDetail(row)}>详情</Button>
                <Button size="small" onClick={() => setCalculating(row)}>计算</Button>
                {row.status === 'draft' && canEdit && <Button size="small" onClick={() => setEditing(row)}>编辑</Button>}
                {canEdit && <Button size="small" onClick={() => void action(`/formulas/${row.id}/clone`, '已复制为新版本草稿。')}>复制</Button>}
                {row.status === 'draft' && canPublish && (
                  <Button
                    size="small"
                    type="primary"
                    onClick={() =>
                      modal.confirm({
                        title: `发布 V${row.versionNo}？`,
                        content: '发布后同专色旧的已发布版本将自动停用。',
                        onOk: () => action(`/formulas/${row.id}/publish`, '已发布。'),
                      })
                    }
                  >
                    发布
                  </Button>
                )}
                {row.status === 'published' && canPublish && (
                  <Button size="small" danger onClick={() => void action(`/formulas/${row.id}/disable`, '已停用。')}>停用</Button>
                )}
                <Button size="small" onClick={() => setAdjusting(row)}>调色记录</Button>
              </Space>
            ),
          },
        ]}
      />
      {detail && <FormulaDetailModal formula={detail} onClose={() => setDetail(null)} />}
      {calculating && <CalculateModal token={token} formula={calculating} onClose={() => setCalculating(null)} />}
      {editing && (
        <FormulaEditModal
          token={token}
          formula={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {adjusting && (
        <AdjustmentsModal
          token={token}
          rights={rights}
          formula={adjusting}
          onClose={() => {
            setAdjusting(null);
            void load();
          }}
        />
      )}
    </Modal>
  );
}
function FormulaEditModal({ token, formula, onClose, onSaved }: { token: string; formula: any; onClose: () => void; onSaved: () => void }) {
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [materials, setMaterials] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    void (async () => {
      try {
        const all = await api<any[]>('/materials', {}, token);
        setMaterials(all.filter((item) => item.status === '启用'));
      } catch (error) {
        message.error(error instanceof Error ? error.message : '物料加载失败。');
      }
    })();
    form.setFieldsValue({
      basisType: formula.basisType ?? '份数',
      targetViscosity: num(formula.targetViscosity),
      viscosityMethod: formula.viscosityMethod ?? undefined,
      viscosityTemperature: num(formula.viscosityTemperature),
      changeReason: formula.changeReason ?? undefined,
      remark: formula.remark ?? undefined,
    });
    setItems(
      (formula.items ?? []).map((item: any, index: number) => ({
        key: item.id ?? `new-${index}`,
        materialId: String(item.materialId ?? item.material?.id),
        ratioPart: Number(item.ratioPart ?? 0),
        componentNote: item.componentNote ?? '',
      })),
    );
  }, []);
  const save = async () => {
    const values = await form.validateFields();
    if (items.length === 0) {
      message.warning('配方至少需要一个组分。');
      return;
    }
    if (items.some((item) => !item.materialId)) {
      message.warning('存在未选择物料的组分。');
      return;
    }
    try {
      await api(`/formulas/${formula.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...values,
          items: items.map((item, index) => ({
            materialId: Number(item.materialId),
            ratioPart: item.ratioPart ?? 0,
            sortNo: index + 1,
            componentNote: item.componentNote || null,
          })),
        }),
      }, token);
      message.success('草稿已保存。');
      onSaved();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    }
  };
  const patchItem = (key: any, patch: Record<string, unknown>) =>
    setItems((prev) => prev.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const usedIds = new Set(items.map((item) => item.materialId));
  return (
    <Modal open title={`编辑草稿 · V${formula.versionNo}`} onCancel={onClose} onOk={() => void save()} width={960} destroyOnHidden>
      <Form form={form} layout="inline" style={{ marginBottom: 12, rowGap: 8 }}>
        <Form.Item name="basisType" label="配比基准" rules={[{ required: true }]}>
          <Select style={{ width: 110 }} options={['份数', '百分比'].map((v) => ({ value: v, label: v }))} />
        </Form.Item>
        <Form.Item name="targetViscosity" label="目标粘度（s）">
          <InputNumber min={0} style={{ width: 110 }} />
        </Form.Item>
        <Form.Item name="viscosityMethod" label="测量方式">
          <Input style={{ width: 120 }} />
        </Form.Item>
        <Form.Item name="viscosityTemperature" label="温度（℃）">
          <InputNumber style={{ width: 100 }} />
        </Form.Item>
        <Form.Item name="changeReason" label="变更原因">
          <Input style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="remark" label="备注">
          <Input style={{ width: 200 }} />
        </Form.Item>
      </Form>
      <Table
        rowKey="key"
        size="small"
        pagination={false}
        dataSource={items}
        footer={() => (
          <Button
            size="small"
            onClick={() => setItems((prev) => [...prev, { key: `new-${Date.now()}`, materialId: undefined, ratioPart: 0, componentNote: '' }])}
          >
            添加组分
          </Button>
        )}
        columns={[
          {
            title: '物料',
            key: 'material',
            width: 260,
            render: (_: unknown, row: any) => (
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
                placeholder="选择物料"
                value={row.materialId}
                onChange={(value) => patchItem(row.key, { materialId: value })}
                options={materials.map((material) => ({
                  value: String(material.id),
                  label: `${material.name}（${MATERIAL_TYPE_LABELS[material.materialType] ?? material.materialType}）`,
                  disabled: usedIds.has(String(material.id)) && row.materialId !== String(material.id),
                }))}
              />
            ),
          },
          {
            title: '配比（份）',
            key: 'ratioPart',
            width: 130,
            render: (_: unknown, row: any) => (
              <InputNumber min={0} style={{ width: '100%' }} value={row.ratioPart} onChange={(value) => patchItem(row.key, { ratioPart: value ?? 0 })} />
            ),
          },
          {
            title: '组分备注',
            key: 'note',
            render: (_: unknown, row: any) => (
              <Input value={row.componentNote} onChange={(e) => patchItem(row.key, { componentNote: e.target.value })} />
            ),
          },
          {
            title: '操作',
            key: 'action',
            width: 80,
            render: (_: unknown, row: any) => (
              <Button size="small" danger type="link" onClick={() => setItems((prev) => prev.filter((item) => item.key !== row.key))}>移除</Button>
            ),
          },
        ]}
      />
    </Modal>
  );
}

function AdjustmentsModal({ token, rights, formula, onClose }: { token: string; rights: string[]; formula: any; onClose: () => void }) {
  const { message, modal } = AntApp.useApp();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [materials, setMaterials] = useState<any[]>([]);
  const [inkEnabled, setInkEnabled] = useState(false);
  const [form] = Form.useForm();
  const canEdit = rights.includes('formula.edit');

  const load = async () => {
    setLoading(true);
    try {
      setRows(await api<any[]>(`/formulas/${formula.id}/adjustments`, {}, token));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    void api<any[]>('/materials', {}, token).then((all) => setMaterials(all.filter((item) => item.status === '启用'))).catch(() => undefined);
  }, []);

  const save = async () => {
    const values = await form.validateFields();
    const additions = (values.items ?? [])
      .filter((item: any) => item && item.materialId && num(item.weightKg))
      .map((item: any) => {
        const material = materials.find((entry) => String(entry.id) === String(item.materialId));
        return { materialId: Number(item.materialId), materialName: material?.name ?? null, weightKg: num(item.weightKg) };
      });
    const payload: Record<string, unknown> = {
      productionBatchNo: values.productionBatchNo || null,
      targetWeight: num(values.targetWeight) ?? null,
      actualViscosityBefore: num(values.actualViscosityBefore) ?? null,
      actualViscosityAfter: num(values.actualViscosityAfter) ?? null,
      result: values.result || null,
      remark: values.remark || null,
      adjustmentItems: additions,
    };
    if (inkEnabled) {
      payload.residualInk = {
        storageLocation: values.inkLocation,
        weightKg: num(values.inkWeightKg) ?? null,
        lStar: num(values.inkL) ?? null,
        aStar: num(values.inkA) ?? null,
        bStar: num(values.inkB) ?? null,
        colorFamily: values.inkColorFamily || null,
      };
    }
    try {
      await api(`/formulas/${formula.id}/adjustments`, { method: 'POST', body: JSON.stringify(payload) }, token);
      message.success(inkEnabled ? '调色记录已保存，余墨已入库。' : '调色记录已保存。');
      setCreating(false);
      setInkEnabled(false);
      form.resetFields();
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    }
  };
  const promote = (row: any) =>
    modal.confirm({
      title: '沉淀为新配方版本？',
      content: '将按本次追加量换算份数，生成新的配方草稿（需发布后生效）。',
      onOk: async () => {
        try {
          const created = await api<any>(`/adjustments/${row.id}/promote`, { method: 'POST' }, token);
          message.success(`已生成草稿 V${created.versionNo}。`);
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '操作失败。');
        }
      },
    });

  return (
    <Modal open title={`调色记录 · V${formula.versionNo}`} footer={null} onCancel={onClose} width={1080} destroyOnHidden>
      {canEdit && (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={() => setCreating(true)}>新增调色记录</Button>
        </Space>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={{ defaultPageSize: 10 }}
        columns={[
          { title: '时间', dataIndex: 'createdAt', width: 110, render: (value: string) => String(value).slice(0, 16).replace('T', ' ') },
          { title: '批次', dataIndex: 'productionBatchNo', width: 110, render: (value: any) => value ?? '—' },
          { title: '目标重量', dataIndex: 'targetWeight', width: 90, render: (value: any) => (value === null || value === undefined ? '—' : `${value} kg`) },
          { title: '粘度前/后', key: 'viscosity', width: 110, render: (_: unknown, row: any) => `${row.actualViscosityBefore ?? '—'} → ${row.actualViscosityAfter ?? '—'} ${row.viscosityUnit ?? 's'}` },
          {
            title: '追加明细',
            key: 'items',
            render: (_: unknown, row: any) =>
              Array.isArray(row.adjustmentItems) && row.adjustmentItems.length
                ? row.adjustmentItems.map((item: any) => `${item.materialName ?? `#${item.materialId}`} +${item.weightKg}kg`).join('；')
                : '—',
          },
          { title: '结果', dataIndex: 'result', width: 90, render: (value: any) => (value ? <Tag color={value === '通过' ? 'green' : value === '作废' ? 'red' : 'gold'}>{value}</Tag> : '—') },
          { title: '余墨', key: 'ink', width: 110, render: (_: unknown, row: any) => (row.residualInk ? <Tag color="cyan">库位 {row.residualInk.storageLocation}</Tag> : '—') },
          {
            title: '沉淀',
            key: 'promoted',
            width: 110,
            render: (_: unknown, row: any) =>
              row.promotedFormula ? (
                <Tag color="green">V{row.promotedFormula.versionNo}</Tag>
              ) : canEdit ? (
                <Button size="small" type="link" onClick={() => promote(row)}>生成新版本</Button>
              ) : (
                '—'
              ),
          },
          { title: '操作人', dataIndex: 'createdBy', width: 90 },
          { title: '备注', dataIndex: 'remark', ellipsis: true },
        ]}
      />
      <Modal
        open={creating}
        title={`新增调色记录 · V${formula.versionNo}`}
        onCancel={() => { setCreating(false); setInkEnabled(false); }}
        onOk={() => void save()}
        width={860}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <div className="form-grid">
            <Form.Item name="productionBatchNo" label="生产/试色批次">
              <Input />
            </Form.Item>
            <Form.Item name="targetWeight" label="本次调配总重量（kg）">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="actualViscosityBefore" label="调整前实测粘度（s）">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="actualViscosityAfter" label="调整后实测粘度（s）">
              <InputNumber style={{ width: '100%' }} min={0} />
            </Form.Item>
            <Form.Item name="result" label="结果">
              <Select allowClear options={['通过', '继续调整', '作废'].map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="remark" label="现场说明">
              <Input />
            </Form.Item>
          </div>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                <Typography.Text strong>追加明细</Typography.Text>
                {fields.map((field) => (
                  <Space key={field.key} style={{ display: 'flex', marginTop: 8 }} align="baseline">
                    <Form.Item name={[field.name, 'materialId']} noStyle>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="追加物料"
                        style={{ width: 260 }}
                        options={materials.map((material) => ({ value: String(material.id), label: material.name }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'weightKg']} noStyle>
                      <InputNumber placeholder="追加重量 kg" min={0} style={{ width: 140 }} />
                    </Form.Item>
                    <Button size="small" type="link" danger onClick={() => remove(field.name)}>移除</Button>
                  </Space>
                ))}
                <Button size="small" type="dashed" style={{ marginTop: 8 }} onClick={() => add()}>添加追加物料</Button>
              </>
            )}
          </Form.List>
          <div style={{ marginTop: 16 }}>
            <Space>
              <Switch checked={inkEnabled} onChange={setInkEnabled} />
              <Typography.Text strong>剩余油墨入余墨库（自动标记来源配方/产品）</Typography.Text>
            </Space>
            {inkEnabled && (
              <div className="form-grid" style={{ marginTop: 12 }}>
                <Form.Item name="inkLocation" label="库位" rules={[{ required: true, message: '请指定库位' }]}>
                  <Input placeholder="如 A01-21" />
                </Form.Item>
                <Form.Item name="inkWeightKg" label="重量（kg）">
                  <InputNumber style={{ width: '100%' }} min={0} />
                </Form.Item>
                <Form.Item name="inkL" label="L">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="inkA" label="a">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="inkB" label="b">
                  <InputNumber style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="inkColorFamily" label="色系">
                  <Input />
                </Form.Item>
              </div>
            )}
          </div>
        </Form>
      </Modal>
    </Modal>
  );
}