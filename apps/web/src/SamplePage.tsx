import { useEffect, useRef, useState } from 'react';
import { App, AutoComplete, Button, Card, Col, Form, Image, Input, Modal, Row, Select, Space, Tag, Upload } from 'antd';
import { BookOutlined, ClearOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { api, API } from './api';
import { ReorderableTable } from './components/ReorderableTable';
import { EmptyState } from './components/ui';

const SAMPLE_TYPE_OPTIONS = [
  { value: '打样', label: '打样' },
  { value: '首单', label: '首单' },
  { value: '大货', label: '大货' },
];
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_EXT = /\.(jpe?g|png)$/i;
const ACCEPTED_MIME = ['image/jpeg', 'image/png'];

type Photo = { id: string; fileName: string; originalName: string; mimeType: string; sizeBytes: string };
type ProductRef = { id: string; code: string; name: string };
type ProductOption = {
  value: string;
  label: string;
  productCode: string;
  productName: string;
  customerName: string | null;
  sampleType: string | null;
};
type Sample = {
  id: string;
  customer: string | null;
  storageLocation: string | null;
  code: string;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  sampleType: string | null;
  remark: string | null;
  photos: Photo[];
  product: ProductRef | null;
};

function blobUrl(path: string, token: string) {
  return fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
    .then((response) => {
      if (!response.ok) throw new Error('加载照片失败。');
      return response.blob();
    })
    .then((blob) => URL.createObjectURL(blob));
}

export function SamplePage({
  token,
  rights,
  onOpenFormulaProduct,
}: {
  token: string;
  rights: string[];
  onOpenFormulaProduct?: (target: { productId?: string; productCode?: string }) => void;
}) {
  const { message, modal } = App.useApp();
  const [rows, setRows] = useState<Sample[]>([]);
  const [keyword, setKeyword] = useState('');
  const [filterCustomer, setFilterCustomer] = useState<string | undefined>(undefined);
  const [filterStorageLocation, setFilterStorageLocation] = useState<string | undefined>(undefined);
  const [filterSampleType, setFilterSampleType] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [customerOptions, setCustomerOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [storageOptions, setStorageOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [productOptions, setProductOptions] = useState<ProductOption[]>([]);
  const [editing, setEditing] = useState<Sample | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [existingPhotos, setExistingPhotos] = useState<Array<{ photo: Photo; url: string }>>([]);
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [form] = Form.useForm();
  // 记录当前已选中产品的编码，用于区分「选中」与「手动修改」
  const selectedProductCodeRef = useRef<string | null>(null);

  const canCreate = rights.includes('sample.create');
  const canUpdate = rights.includes('sample.update');
  const canDelete = rights.includes('sample.delete');

  const load = async (nextKeyword = keyword) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (nextKeyword) params.set('keyword', nextKeyword);
      if (filterCustomer) params.set('customer', filterCustomer);
      if (filterStorageLocation) params.set('storageLocation', filterStorageLocation);
      if (filterSampleType) params.set('sampleType', filterSampleType);
      const query = params.toString() ? `?${params.toString()}` : '';
      const result = await api<Sample[]>(`/samples${query}`, {}, token);
      setRows(Array.isArray(result) ? result : []);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败。');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load('');
    api<{ rows: Array<{ value: string; label: string }> }>('/samples/customer-options', {}, token)
      .then((result) => setCustomerOptions(result.rows ?? []))
      .catch(() => undefined);
    api<{ rows: Array<{ value: string; label: string }> }>('/samples/storage-locations', {}, token)
      .then((result) => setStorageOptions(result.rows ?? []))
      .catch(() => undefined);
  }, [token]);

  const resetFilters = () => {
    setKeyword('');
    setFilterCustomer(undefined);
    setFilterStorageLocation(undefined);
    setFilterSampleType(undefined);
    void load('');
  };

  const searchProducts = async (keywordValue: string) => {
    try {
      const query = keywordValue.trim() ? `?keyword=${encodeURIComponent(keywordValue.trim())}` : '';
      const result = await api<{ rows: ProductOption[] }>(`/samples/product-options${query}`, {}, token);
      setProductOptions(result.rows ?? []);
    } catch {
      setProductOptions([]);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setExistingPhotos([]);
    setFileList([]);
    selectedProductCodeRef.current = null;
    form.resetFields();
    form.setFieldValue('productId', null);
    setModalOpen(true);
  };
  const openEdit = (row: Sample) => {
    setEditing(row);
    setExistingPhotos([]);
    setFileList([]);
    selectedProductCodeRef.current = row.productCode ?? null;
    form.setFieldsValue({
      customer: row.customer,
      storageLocation: row.storageLocation,
      code: row.code,
      productId: row.product?.id ?? null,
      productCode: row.productCode,
      productName: row.productName,
      sampleType: row.sampleType,
      remark: row.remark,
    });
    setModalOpen(true);
    for (const photo of row.photos ?? []) {
      blobUrl(`/samples/${row.id}/photos/${photo.id}`, token)
        .then((url) => setExistingPhotos((prev) => [...prev, { photo, url }]))
        .catch(() => undefined);
    }
  };

  const beforeUpload = (file: UploadFile) => {
    if (!ACCEPTED_MIME.includes(file.type as string) || !ACCEPTED_EXT.test(file.name)) {
      message.warning('仅支持 JPG / JPEG / PNG 格式图片。');
      return Upload.LIST_IGNORE;
    }
    if ((file.size ?? 0) > MAX_PHOTO_BYTES) {
      message.warning('单张照片不能超过 5MB。');
      return Upload.LIST_IGNORE;
    }
    if (fileList.length + existingPhotos.length >= MAX_PHOTOS) {
      message.warning(`每个样品最多 ${MAX_PHOTOS} 张照片。`);
      return Upload.LIST_IGNORE;
    }
    return false; // 阻止自动上传，保存时统一提交
  };

  const save = async () => {
    const values = await form.validateFields();
    try {
      let sample: Sample;
      if (editing?.id) {
        sample = await api<Sample>(`/samples/${editing.id}`, { method: 'PUT', body: JSON.stringify(values) }, token);
      } else {
        sample = await api<Sample>('/samples', { method: 'POST', body: JSON.stringify(values) }, token);
      }
      if (fileList.length) {
        const data = new FormData();
        for (const file of fileList) data.append('files', file.originFileObj as File);
        await api(`/samples/${sample.id}/photos`, { method: 'POST', body: data }, token);
      }
      message.success('已保存。');
      setModalOpen(false);
      await load();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败。');
    }
  };

  const removePhoto = (photo: Photo) => {
    if (!editing) return;
    modal.confirm({
      title: '确认删除这张照片？',
      content: '删除后不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api(`/samples/${editing.id}/photos/${photo.id}`, { method: 'DELETE' }, token);
          message.success('已删除。');
          openEdit(editing);
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败。');
        }
      },
    });
  };

  const remove = (row: Sample) => {
    modal.confirm({
      title: `确认删除样品「${row.code}」？`,
      content: '删除后不可恢复，其照片也会一并删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await api(`/samples/${row.id}`, { method: 'DELETE' }, token);
          message.success('已删除。');
          await load();
        } catch (error) {
          message.error(error instanceof Error ? error.message : '删除失败。');
        }
      },
    });
  };

  const toolbar = (
    <Space wrap size={8}>
      <Select
        allowClear
        showSearch
        placeholder="客户筛选"
        style={{ width: 150 }}
        value={filterCustomer}
        options={customerOptions}
        optionFilterProp="label"
        onChange={(value) => setFilterCustomer(value)}
      />
      <Select
        allowClear
        showSearch
        placeholder="存放位置"
        style={{ width: 150 }}
        value={filterStorageLocation}
        options={storageOptions}
        optionFilterProp="label"
        onChange={(value) => setFilterStorageLocation(value)}
      />
      <Select
        allowClear
        placeholder="样品类型"
        style={{ width: 120 }}
        value={filterSampleType}
        options={SAMPLE_TYPE_OPTIONS}
        onChange={(value) => setFilterSampleType(value)}
      />
      <Input
        allowClear
        placeholder="编号 / 产品编码 / 产品名称"
        style={{ width: 220 }}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        onPressEnter={() => void load()}
      />
      <Button type="primary" icon={<SearchOutlined />} onClick={() => void load()}>
        查询
      </Button>
      <Button icon={<ClearOutlined />} onClick={resetFilters}>
        清空
      </Button>
    </Space>
  );

  return (
    <>
      <Card className="page-toolbar">{toolbar}</Card>
      <Card
        title="样品档案"
        extra={
          canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增样品
            </Button>
          ) : undefined
        }
      >
        <ReorderableTable
          rowKey="id"
          storageKey="samples"
          loading={loading}
          dataSource={rows}
          pagination={{ defaultPageSize: 10, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'] }}
          scroll={{ x: true }}
          locale={{ emptyText: <EmptyState text="暂无样品记录" /> }}
          columns={[
            { title: '客户', dataIndex: 'customer', width: 140, render: (v: string | null) => v ?? '—' },
            { title: '存放位置', dataIndex: 'storageLocation', width: 120, render: (v: string | null) => v ?? '—' },
            { title: '编号', dataIndex: 'code', width: 120 },
            { title: '产品编码', dataIndex: 'productCode', width: 120, render: (v: string | null) => v ?? '—' },
            { title: '产品名称', dataIndex: 'productName', width: 160, render: (v: string | null) => v ?? '—' },
            {
              title: '样品类型',
              dataIndex: 'sampleType',
              width: 100,
              render: (v: string | null) => (v ? <Tag color="blue">{v}</Tag> : '—'),
            },
            {
              title: '照片',
              dataIndex: 'photos',
              width: 90,
              render: (photos: Photo[]) => (photos?.length ? `${photos.length} 张` : '—'),
            },
            {
              title: '操作',
              key: 'action',
              fixed: 'right',
              width: 230,
              render: (_: unknown, row: Sample) => (
                <Space size={4}>
                  {row.productId && onOpenFormulaProduct && (
                    <Button
                      size="small"
                      type="primary"
                      icon={<BookOutlined />}
                      onClick={() => onOpenFormulaProduct({ productId: row.productId ?? undefined, productCode: row.productCode ?? undefined })}
                    >
                      查看配方
                    </Button>
                  )}
                  <Button size="small" icon={<EditOutlined />} disabled={!canUpdate} onClick={() => openEdit(row)}>
                    编辑
                  </Button>
                  <Button size="small" danger icon={<DeleteOutlined />} disabled={!canDelete} onClick={() => remove(row)}>
                    删除
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        title={editing?.id ? `编辑样品：${editing.code}` : '新增样品'}
        open={modalOpen}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
        width={760}
        onCancel={() => setModalOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={() => void save()}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="code" label="编号" rules={[{ required: true, message: '请输入编号。' }]}>
                <Input maxLength={80} placeholder="请输入编号" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="customer" label="客户">
                <Select showSearch allowClear placeholder="请选择客户" options={customerOptions} optionFilterProp="label" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="storageLocation" label="存放位置">
                <Input maxLength={120} placeholder="请输入存放位置" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="sampleType" label="样品类型" rules={[{ required: true, message: '请选择样品类型。' }]}>
                <Select allowClear placeholder="请选择样品类型" options={SAMPLE_TYPE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="productId" hidden>
                <Input />
              </Form.Item>
              <Form.Item name="productCode" label="产品编码" tooltip="可输入或选择，选择后自动带出产品名称等信息">
                <AutoComplete
                  allowClear
                  placeholder="输入或选择产品编码"
                  options={productOptions.map((opt) => ({
                    value: opt.productCode,
                    label: opt.productName ? `${opt.productCode}（${opt.productName}）` : opt.productCode,
                    productOption: opt,
                  }))}
                  filterOption={false}
                  onSearch={(value) => void searchProducts(value)}
                  onChange={(value) => {
                    // 手动修改使输入与已选产品编码不一致时，清除关联，改为自由输入
                    if (selectedProductCodeRef.current && value !== selectedProductCodeRef.current) {
                      selectedProductCodeRef.current = null;
                      form.setFieldValue('productId', null);
                    }
                  }}
                  onSelect={(_value, option: { productOption: ProductOption }) => {
                    const opt = option.productOption;
                    selectedProductCodeRef.current = opt.productCode;
                    form.setFieldsValue({
                      productId: opt.value,
                      productCode: opt.productCode,
                      productName: opt.productName,
                      customer: form.getFieldValue('customer') || opt.customerName,
                      sampleType: form.getFieldValue('sampleType') || opt.sampleType,
                    });
                  }}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="productName" label="产品名称">
                <Input maxLength={200} placeholder="选择产品编码后自动带出" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label={`图片（每张 ≤5MB，最多 ${MAX_PHOTOS} 张，JPG/JPEG/PNG）`}>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  {existingPhotos.length > 0 && (
                    <Space wrap size={8}>
                      {existingPhotos.map(({ photo, url }) => (
                        <div key={photo.id} style={{ position: 'relative', display: 'inline-block' }}>
                          <Image src={url} width={72} height={72} style={{ objectFit: 'cover', borderRadius: 6 }} preview={{ mask: '查看' }} />
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            style={{ position: 'absolute', top: -6, right: -6 }}
                            disabled={!canUpdate}
                            onClick={() => removePhoto(photo)}
                          />
                        </div>
                      ))}
                    </Space>
                  )}
                  <Upload
                    multiple
                    listType="picture"
                    accept=".jpg,.jpeg,.png"
                    fileList={fileList}
                    beforeUpload={beforeUpload}
                    onChange={({ fileList: next }) => setFileList(next.slice(0, MAX_PHOTOS - existingPhotos.length))}
                  >
                    <Button icon={<UploadOutlined />}>选择图片</Button>
                  </Upload>
                </Space>
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea maxLength={1000} rows={3} placeholder="请输入备注" showCount />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}