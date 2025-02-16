import React from 'react';
import AirplaySharpIcon from '@material-ui/icons/AirplaySharp';
import ComBaseToolIconButton from '../base';
import logger from '../../../utils/logger';

interface ComShareScreenControllerProps {
  mode?: string;
  onChangeSharing: () => void;
}

function ComShareScreenController(props: ComShareScreenControllerProps) {
  const { mode, onChangeSharing } = props;
  const renderIcon = () => <AirplaySharpIcon />;
  const onIconClick = () => {
    logger.log('[ComShareScreenController] clicked');
    onChangeSharing();
  };

  return (
    <ComBaseToolIconButton
      name="共享屏幕"
      mode={mode}
      renderIcon={renderIcon}
      onClickIcon={onIconClick}
    />
  );
}

ComShareScreenController.defaultProps = {
  mode: 'small',
};

export default ComShareScreenController;
