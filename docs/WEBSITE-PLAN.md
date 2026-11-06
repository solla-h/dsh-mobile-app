# 宣传站开发入口

宣传站已拆为独立仓库：**[solla-h/dsh-mobile-site](https://github.com/solla-h/dsh-mobile-site)**。
拟使用域名 `fatwhale.app`；目前完成开发骨架与 CI，正式页面和 Cloudflare 域名绑定尚未上线。

后续页面开发以网站仓库为准：

- [README：本地预览与检查](https://github.com/solla-h/dsh-mobile-site/blob/main/README.md)
- [AGENTS.md：开发约定](https://github.com/solla-h/dsh-mobile-site/blob/main/AGENTS.md)
- [内容提纲与布局](https://github.com/solla-h/dsh-mobile-site/blob/main/docs/BRIEF.md)
- [Cloudflare Pages 部署、更新与回滚](https://github.com/solla-h/dsh-mobile-site/blob/main/docs/DEPLOYMENT.md)

两个仓库独立提交、检查和发布。网站的 `main` 分支部署 `site/`；App 继续在本仓库构建 APK，
通过 [Releases](https://github.com/solla-h/dsh-mobile-app/releases) 分发。
网站引用本仓库的安装指南、版本兼容记录和下载入口，不复制一套容易失效的安装或版本事实。

本文件保留为旧方案链接的入口，具体页面方案只在网站仓库维护。
