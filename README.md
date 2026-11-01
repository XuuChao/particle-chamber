# Particle Chamber

A browser artwork for people who want to play with shapes. Draw an outline,
then turn it into a rounded, three-dimensional particle sculpture.

一个可以玩图形的网页作品。画一个轮廓，就能生成前后鼓起的立体粒子形状。

![A hand-drawn heart turned into a glowing particle sculpture inside a dark display case](docs/screenshot.png)

Choose **Draw your own**, draw one outline, then **Make particles**. Move the
pointer to disturb it; drag or use the canvas arrow keys to rotate. **Pause**
stops movement. **Clear** erases the drawing; **Reset** restores the sphere.

点击 **Draw your own** 画轮廓，再点 **Make particles**。移动鼠标扰动粒子，拖动或聚焦展柜后按方向键旋转。**Pause** 暂停，**Clear** 清空画板，**Reset** 恢复球体。

## Run / 运行

With Node.js 18 or later, run from this folder. No packages need installing.

使用 Node.js 18 或以上版本，在本文件夹运行，无需安装额外依赖。

```bash
node server.mjs
```

Open / 打开：<http://127.0.0.1:8000>. Stop / 停止：Ctrl+C.

## Limits / 局限

One outline at a time; thickness is estimated. Requires WebGL 2. Drawings stay
in memory and disappear on reload. Graphics assets are local, so it runs without
internet. A real user trial is still to do.

一次画一个轮廓，厚度由程序估算。需要 WebGL 2，刷新后绘画不会保留。图形资源都在本地，可以断网运行。实际用户试用还没有完成。
