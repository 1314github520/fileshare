# SOFT/SHARE

一个复古风格的公共软件分享站。访客可以浏览、模糊搜索、上传单个文件或整个文件夹，并下载软件包。上传文件和索引数据保存在服务器的 `data/` 目录中，适合先部署到单台 Linux 服务器。

文件夹上传会保留浏览器提供的相对路径。目录页支持点击文件夹进入子目录，并通过 `..` 返回上一级；空文件夹不会被上传，因为浏览器不会提交空目录条目。

## 本地运行

需要 Node.js 18 或更高版本：

```bash
npm install
npm start
```

打开 `http://localhost:3000`。服务会自动创建 `data/files.json` 和 `data/uploads/`。

## Linux 部署

```bash
git clone <你的仓库地址> /opt/softshare
cd /opt/softshare
npm ci --omit=dev
PORT=3000 npm start
```

建议使用 systemd 保持服务运行，并用 Nginx/Caddy 将域名反代到 `127.0.0.1:3000`。生产环境请定期备份 `data/`，并在反向代理层启用 HTTPS 和上传体积限制。当前单文件上传上限为 2GB，可在 `server.js` 的 `multer` 配置中调整。

仓库内的 `deploy/softshare.service` 和 `deploy/softshare.nginx.conf` 是对应的配置模板。修改域名和项目路径后，可以这样启用：

```bash
sudo cp deploy/softshare.service /etc/systemd/system/softshare.service
sudo systemctl daemon-reload
sudo systemctl enable --now softshare
sudo cp deploy/softshare.nginx.conf /etc/nginx/sites-available/softshare
sudo ln -s /etc/nginx/sites-available/softshare /etc/nginx/sites-enabled/softshare
sudo nginx -t && sudo systemctl reload nginx
```

## 生产注意事项

这是一个开放上传站，正式公开前建议补充登录、举报/审核、恶意文件扫描、上传频率限制和对象存储。服务不会执行上传文件，只负责保存和下载。
