import React from 'react';

/**
 * 三段式脚手架的「页头」：模块色竖条 + 标题 + 描述 + 右侧主操作按钮组。
 * 统一所有业务页面的标题区，标题下沉到内容区首行，顶栏只保留面包屑与全局操作。
 */
export default function PageHeader({
  title,
  desc,
  actions,
}: {
  title: React.ReactNode;
  desc?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-main">
        <span className="page-header-bar" />
        <div className="page-header-text">
          <h2>{title}</h2>
          {desc && <small>{desc}</small>}
        </div>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}