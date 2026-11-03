import { LayoutAnimation } from 'react-native';

/**
 * 「展开的思考行收成胶囊」的收拢动画。
 *
 * LayoutAnimation.configureNext 只作用于**紧接着的那一次布局**，所以必须在
 * 引起折叠的 setState **之前**调用（帧回调里、提交前上膛）。挂在组件里
 * （mount 后 / 状态变化的 useEffect）再 configure 时提交已经发生，动画要么
 * 落到更后面的无关布局上、要么根本落空——真机上表现为瞬切（FLOW-1 ③）。
 *
 * create/delete 的 opacity 就是「展开行删掉、胶囊出现」的淡入淡出；
 * update 用 springDamping 1（过阻尼）锚住，不让整页回弹。
 */
export function armCollapseAnimation(): void {
  LayoutAnimation.configureNext({
    duration: 240,
    update: { type: LayoutAnimation.Types.spring, springDamping: 1 },
    create: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
    delete: {
      type: LayoutAnimation.Types.easeInEaseOut,
      property: LayoutAnimation.Properties.opacity,
    },
  });
}
