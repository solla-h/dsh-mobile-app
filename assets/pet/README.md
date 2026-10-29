# 宠物素材（大肥鱼）

这里的 5 个 WebP 不是本项目原创，来自开源桌宠项目 **dsh-pet**：

- 仓库：https://github.com/PC2005-cloud/dsh-pet
- 形象：「大肥鱼」（鲸鱼娘 / DeepSeek 社区二创形象）
- 原型「溟月」出自 B 站 @上善无形；DeepSeek 版设计出自 B 站 @ZipZipPipe
- 授权：**CC BY-NC-SA 4.0**（署名 · 非商业 · 相同方式共享）

本项目对素材做的处理（全部可复现，脚本见对话记录 / git 历史）：

1. 从 `dsh-pet/assets/webm/<动作名>.webm`（640×360 VP9-alpha）用 ffmpeg
   `-c:v libvpx-vp9 -pix_fmt rgba` 抽帧，12fps；
2. 按人物包围盒裁切（185,49)-(446,341)，缩放到 264×296；
3. 把 alpha ≤ 12 的噪点清零；
4. 用 Pillow 编码成动画 WebP（quality 78）。

| 文件 | 来源动作 | 帧数 | 本应用里的用途 |
| --- | --- | --- | --- |
| `fish-idle.webp` | 待机呼吸休闲 | 30 | 静息 |
| `fish-listen.webp` | 点击回应-害羞惊讶 | 24 | 按住说话 / 录音中 |
| `fish-think.webp` | 工作状态-思考冒泡 | 24 | 服务端识别中 |
| `fish-happy.webp` | 点击回应-开心跃动 | 26 | 点击回应、松手发送成功 |
| `fish-startle.webp` | 被吓一跳 | 18 | 上滑取消 |
| `fish-work.webp` | 工作状态-忙碌点按 | 24 | 有任务在跑时的常态 |
| `fish-angry.webp` | 点击回应-傲娇生气 | 17 | 戳尾巴 |

**非商业用途**：本项目是个人开源项目，未用于商业分发。若要把 App 商业化，
必须先替换掉这套素材（或取得作者授权）。
