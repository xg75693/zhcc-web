#!/usr/bin/env bash
# 服务器端增量部署脚本：git pull → 安装依赖 → 构建前端 → 重启 PM2
# 项目：zhcc-web (中辉仓储订货咨询系统)
# 在服务器执行: cd /data/hitech/node1/app/zhcc-web && bash deploy.sh
set -e

cd "$(dirname "$0")"

APP_NAME="zhcc-web"

# 检查后端 .env 文件
if [ ! -f backend/.env ]; then
  echo "❌ 未找到 backend/.env 文件，请先配置环境变量"
  exit 1
fi

echo "==> [1/5] 拉取最新代码"
git pull

echo "==> [2/5] 安装后端依赖"
cd backend
npm install --prefer-offline 2>&1 | tail -3
cd ..

echo "==> [3/5] 安装前端依赖并构建"
cd frontend
npm install --prefer-offline 2>&1 | tail -3
npm run build

if [ ! -f dist/index.html ]; then
  echo "❌ 前端构建失败：dist/index.html 不存在"
  exit 1
fi
cd ..

echo "==> [4/5] 重启 PM2 进程"
if pm2 describe ${APP_NAME} > /dev/null 2>&1; then
  pm2 restart ${APP_NAME}
else
  # 首次通过 deploy.sh 部署时自动生成 ecosystem 配置
  if [ ! -f ecosystem.config.cjs ]; then
    cat > ecosystem.config.cjs <<'EOF'
module.exports = {
  apps: [{
    name: 'zhcc-web',
    cwd: __dirname + '/backend',
    script: 'src/app.js',
    env: { NODE_ENV: 'production' },
    autorestart: true,
    max_restarts: 10,
    watch: false
  }]
};
EOF
  fi
  pm2 start ecosystem.config.cjs
fi

echo "==> [5/5] 保存 PM2 列表"
pm2 save

echo "✅ 部署完成 - $(date '+%Y-%m-%d %H:%M:%S')"
