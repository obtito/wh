// Viewpoint locations follow GTA-NJ builders, not a surveyed component registry.
export const HERITAGE = {
  mingxiaoling: {
    title: '明孝陵 · 全序列', serial: 'NJ·003', model: 'tomb',
    summary: '下马坊至宝顶的程序化组群；可逐段定位查看。',
    limitation: '原模型将弯曲神道简化为直线，并沿用水平/竖向不同的场景比例。未装载外部扫描件、御河桥与栏杆精模；神兽使用程序化回退。非测绘或完整原位扫描。',
    components: [
      { name: '下马坊', z: 16.5, span: 1.4 },
      { name: '大金门', z: 14.3, span: 2 },
      { name: '四方城', z: 12.2, span: 2.2 },
      { name: '神道六兽', z: 7.6, span: 7.2 },
      { name: '石望柱与翁仲', z: 4.2, span: 2.6 },
      { name: '棂星门', z: 3.3, span: 1.8 },
      { name: '御河桥位置', z: 2.9, span: 2.2, note: '仅河带与铺装；桥精模未装载' },
      { name: '文武方门', z: 2.3, span: 2.4 },
      { name: '碑殿', z: 1.6, span: 2.2 },
      { name: '享殿', z: 0.6, span: 3.2 },
      { name: '方城明楼', z: 0, span: 3.2 },
      { name: '宝顶与宝城', z: -2.1, span: 5.8 },
    ],
  },
  zhongshanling: {
    title: '中山陵 · 全轴线', serial: 'NJ·004', model: 'mausoleum',
    summary: '博爱坊、墓道、陵门、碑亭、台阶平台、祭堂与墓室。',
    limitation: '沿用原程序化构建器及场景比例。台阶以分段平台表达，不是逐级精确建模的 392 级台阶；“自由钟”平面尚未完整实现。非测绘模型。',
    components: [
      { name: '博爱坊', z: 7.2, span: 2 },
      { name: '墓道', z: 5.0, span: 5.4 },
      { name: '陵门', z: 2.8, span: 2.2 },
      { name: '碑亭', z: 2.1, span: 2.2 },
      { name: '台阶与平台', z: 0.9, span: 3.6 },
      { name: '祭堂', z: 0, span: 2.7 },
      { name: '墓室', z: -0.38, span: 2 },
    ],
  },
};
