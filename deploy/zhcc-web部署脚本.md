# ========================================
# zhcc-web（中辉仓储订货咨询系统） 完整部署脚本
# 架构：Vite + React 前端 + Express 后端(:8081) + MySQL
# Nginx 反向代理 → 前端静态文件(frontend/dist) + Node Express API(127.0.0.1:8081)
# 用法：在服务器上以 root 执行  bash zhcc-web部署脚本.md
# 说明：本脚本参照 hitech-web 部署脚本，适配 zhcc-web 前后端分离结构
# ========================================

# ---- 路径变量 ----
TRUNK_DIR="/data/hitech/node1/trunk"
DEPLOY_DIR="/data/hitech/node1/app"
APP_NAME="zhcc-web"
APP_DIR="${DEPLOY_DIR}/${APP_NAME}"
GIT_REPO="git@github.com:xg75693/zhcc-web.git"
ARCHIVE_FILE="${TRUNK_DIR}/${APP_NAME}.tar.gz"
NGINX_TARGET="/etc/nginx/conf.d/nginx.conf"
ENV_BACKUP="${TRUNK_DIR}/${APP_NAME}.env.bak"

set -e

echo "=== zhcc-web 部署开始 ==="

# ========================================
# 1. 停止现有服务 & 备份 .env
# ========================================
echo "[1/8] 停止现有服务..."
# 备份现有 backend/.env（跨部署保留数据库凭据等敏感配置）
if [ -f "${APP_DIR}/backend/.env" ]; then
  cp -f "${APP_DIR}/backend/.env" "${ENV_BACKUP}"
  echo "       已备份 .env → ${ENV_BACKUP}"
fi

pm2 stop ${APP_NAME} 2>/dev/null || true
pm2 delete ${APP_NAME} 2>/dev/null || true

# 清理旧代码
rm -rf ${TRUNK_DIR}/${APP_NAME}
rm -rf ${APP_DIR}

# ========================================
# 2. 获取代码（优先本地 tar 包，否则 git clone）
# ========================================
echo "[2/8] 获取代码..."
mkdir -p ${TRUNK_DIR}
cd ${TRUNK_DIR}

if [ -f "${ARCHIVE_FILE}" ]; then
  echo "       使用本地归档: ${ARCHIVE_FILE}"
  mkdir -p ${APP_NAME}
  tar -xzf "${ARCHIVE_FILE}" -C ${APP_NAME} --strip-components=1
  rm -f "${ARCHIVE_FILE}"
elif command -v git >/dev/null 2>&1; then
  echo "       通过 Git 拉取..."
  if ! git clone -b main ${GIT_REPO}; then
    echo "❌ Git 拉取失败，且未找到本地归档 ${ARCHIVE_FILE}"
    echo "   请在本能访问 GitHub 的机器上执行："
    echo "   git archive --format=tar.gz --prefix=zhcc-web/ -o zhcc-web.tar.gz HEAD"
    echo "   scp zhcc-web.tar.gz root@<服务器IP>:${TRUNK_DIR}/"
    exit 1
  fi
else
  echo "❌ 未找到本地归档 ${ARCHIVE_FILE}，且服务器未安装 git"
  exit 1
fi

# ========================================
# 3. 复制到部署目录
# ========================================
echo "[3/8] 复制到部署目录..."
mkdir -p ${APP_DIR}
cp -rT ${TRUNK_DIR}/${APP_NAME} ${APP_DIR}

# ========================================
# 4. 配置环境变量
# ========================================
echo "[4/8] 配置环境变量..."
cd ${APP_DIR}/backend

# .env.production 已被 .gitignore 排除，不会随 git clone 进入仓库
# 因此按优先级恢复：自带 .env.production > 上次备份 > 首次生成模板
if [ -f .env.production ]; then
  cp -f .env.production .env
  echo "       已从 .env.production 生成 .env"
elif [ -f "${ENV_BACKUP}" ]; then
  cp -f "${ENV_BACKUP}" .env
  echo "       已恢复上次部署的 .env"
else
  cat > .env <<'EOF'
# 数据库配置（生产环境 MySQL 在本机 127.0.0.1）
DB_HOST="127.0.0.1"
DB_PORT=3306
DB_USER="hitech_user"
DB_PASSWORD="请填写真实密码"
DB_NAME="zhcc_warehouse"

# 服务端口
PORT=8081

# 后台管理账号
ADMIN_USER=admin
ADMIN_PASS=请填写真实密码
ADMIN_SECRET=请填写真实密钥

# 智谱 AI
ZHIPU_API_KEY=请填写真实Key
ZHIPU_MODEL=glm-4-flash
EOF
  echo "⚠️  首次部署：已生成 .env 模板"
  echo "   请编辑 ${APP_DIR}/backend/.env 填入真实凭据后重新运行本脚本"
  exit 1
fi

# ========================================
# 5. 安装依赖 & 构建前端
# ========================================
echo "[5/8] 安装依赖并构建前端..."

echo "       -- 后端依赖 --"
cd ${APP_DIR}/backend
npm ci

echo "       -- 前端依赖 --"
cd ${APP_DIR}/frontend
npm ci

echo "       -- 构建前端 --"
npm run build

# 验证构建产物
if [ ! -f dist/index.html ]; then
  echo "❌ 前端构建失败：dist/index.html 不存在，请检查构建日志"
  exit 1
fi
echo "       构建产物: ${APP_DIR}/frontend/dist"

# ========================================
# 6. 启动 Node.js 后端服务（PM2）
# ========================================
echo "[6/8] 启动 PM2 进程..."
cd ${APP_DIR}

# 生成 PM2 进程配置：后端从 backend/ 目录启动，使 dotenv 正确读取 backend/.env
cat > ${APP_DIR}/ecosystem.config.cjs <<'EOF'
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

NODE_ENV=production pm2 start ecosystem.config.cjs
pm2 save

# ========================================
# 7. 验证服务
# ========================================
echo "[7/8] 验证服务..."
sleep 3

echo "--- 后端健康检查（/api/health）---"
curl -s http://localhost:8081/api/health || echo "（接口检查失败，请查看 PM2 日志：pm2 logs zhcc-web）"
echo ""

echo "--- 数据库连通检查（/api/customers）---"
curl -s http://localhost:8081/api/customers | head -c 200 || echo "（接口检查失败）"
echo ""

pm2 list

# ========================================
# 8. 更新 Nginx 站点配置
# ========================================
echo "[8/8] 更新 Nginx 配置..."
# nginx/nginx.conf 已包含 hitech-web 与 zhcc-web 两个 server 块，整体覆盖到 conf.d
\cp -f ${APP_DIR}/nginx/nginx.conf ${NGINX_TARGET}

nginx -t && systemctl reload nginx

echo "=== zhcc-web 部署完成 - $(date '+%Y-%m-%d %H:%M:%S') ==="
# ========================================
