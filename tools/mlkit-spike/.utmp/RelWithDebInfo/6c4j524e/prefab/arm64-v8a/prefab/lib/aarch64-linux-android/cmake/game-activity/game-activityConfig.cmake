if(NOT TARGET game-activity::game-activity)
add_library(game-activity::game-activity STATIC IMPORTED)
set_target_properties(game-activity::game-activity PROPERTIES
    IMPORTED_LOCATION "/home/rinta/.gradle/caches/9.1.0/transforms/96dbfd18496dea524ece91b982f55522/transformed/jetified-games-activity-4.4.2/prefab/modules/game-activity/libs/android.arm64-v8a/libgame-activity.a"
    INTERFACE_INCLUDE_DIRECTORIES "/home/rinta/.gradle/caches/9.1.0/transforms/96dbfd18496dea524ece91b982f55522/transformed/jetified-games-activity-4.4.2/prefab/modules/game-activity/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

if(NOT TARGET game-activity::game-activity_static)
add_library(game-activity::game-activity_static STATIC IMPORTED)
set_target_properties(game-activity::game-activity_static PROPERTIES
    IMPORTED_LOCATION "/home/rinta/.gradle/caches/9.1.0/transforms/96dbfd18496dea524ece91b982f55522/transformed/jetified-games-activity-4.4.2/prefab/modules/game-activity_static/libs/android.arm64-v8a/libgame-activity_static.a"
    INTERFACE_INCLUDE_DIRECTORIES "/home/rinta/.gradle/caches/9.1.0/transforms/96dbfd18496dea524ece91b982f55522/transformed/jetified-games-activity-4.4.2/prefab/modules/game-activity_static/include"
    INTERFACE_LINK_LIBRARIES ""
)
endif()

