import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import productRoutes from './routes/product.js';
import inquiryRoutes from './routes/inquiry.js';
import inquiryExcelRoutes from './routes/inquiryExcel.js';
import adminRoutes from './routes/admin.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8081;

// 中间件
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 路由
app.use('/api', productRoutes);
app.use('/api/inquiry', inquiryRoutes);
app.use('/api/inquiry/excel', inquiryExcelRoutes);
app.use('/api/admin', adminRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: '中辉仓储订货咨询系统', timestamp: new Date().toISOString() });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`[SERVER] 中辉仓储订货咨询系统后端已启动，端口: ${PORT}`);
});
